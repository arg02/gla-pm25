#!/usr/bin/env Rscript
# LAQN (Imperial) PM2.5 annual means for sites continuously open since 2021.
# Uses openair::importMeta + importImperial. Cohort: currently open, OpeningDate
# year <= 2021, non-industrial, Roadside/Background grouped, >=75% capture in
# every complete year 2021–2025.

suppressPackageStartupMessages({
  library(openair)
  library(dplyr)
  library(jsonlite)
  library(lubridate)
})

ROOT <- if (file.exists("R/fetch_laqn_pm25_annual.R")) {
  normalizePath(".")
} else {
  normalizePath(file.path(".."))
}
OUT_PATH <- file.path(ROOT, "data", "laqn-site-years.json")
dir.create(file.path(ROOT, "data"), showWarnings = FALSE, recursive = TRUE)

COMPLETE_YEARS <- 2021:2025
CURRENT_YEAR <- as.integer(format(Sys.Date(), "%Y"))
ALL_YEARS <- 2021:CURRENT_YEAR
MIN_COVERAGE <- 0.75
EXCLUDED_SITE_CODES <- c("LRS", "LBG")
LONDON_LAT <- c(51.2868, 51.6917)
LONDON_LNG <- c(-0.5104, 0.3344)

`%||%` <- function(x, y) {
  if (is.null(x) || length(x) == 0 || (length(x) == 1 && is.na(x))) y else x
}

expected_hours <- function(year_val) {
  start <- as.POSIXct(sprintf("%d-01-01 00:00:00", year_val), tz = "GMT")
  end <- as.POSIXct(sprintf("%d-01-01 00:00:00", year_val + 1), tz = "GMT")
  as.integer(as.numeric(difftime(end, start, units = "hours")))
}

expected_hours_ytd <- function(year_val) {
  start <- as.POSIXct(sprintf("%d-01-01 00:00:00", year_val), tz = "GMT")
  now <- as.POSIXct(format(Sys.time(), tz = "GMT"), tz = "GMT")
  max(1L, as.integer(as.numeric(difftime(now, start, units = "hours"))))
}

get_pm25_column <- function(df) {
  if (is.null(df) || nrow(df) == 0) return(NULL)
  cols <- names(df)
  idx <- which(tolower(cols) %in% c("pm2.5", "pm25"))
  if (length(idx) > 0) cols[idx[1]] else NULL
}

group_site_type <- function(site_type) {
  t <- as.character(site_type %||% "")
  if (!nzchar(t)) return(NA_character_)
  if (grepl("industrial|rural|indoor", t, ignore.case = TRUE)) return(NA_character_)
  if (grepl("kerbside|roadside|urban traffic", t, ignore.case = TRUE)) return("Roadside")
  if (grepl("urban background|suburban background|suburban|background", t, ignore.case = TRUE)) {
    return("Background")
  }
  NA_character_
}

opening_year <- function(meta_row) {
  raw <- meta_row$OpeningDate %||% meta_row$opening_date %||% meta_row$start_date
  if (inherits(raw, "POSIXt") || inherits(raw, "Date")) return(as.integer(year(raw)))
  y <- suppressWarnings(as.integer(substr(as.character(raw), 1, 4)))
  if (length(y) == 1 && is.finite(y)) y else NA_integer_
}

is_currently_open <- function(meta_row) {
  raw <- meta_row$ClosingDate %||% meta_row$closing_date %||% meta_row$end_date
  if (is.null(raw) || length(raw) == 0 || all(is.na(raw))) return(TRUE)
  closed <- tryCatch(as.POSIXct(raw[[1]], tz = "GMT"), error = function(e) NA)
  if (length(closed) == 0 || is.na(closed[[1]])) return(TRUE)
  closed[[1]] > Sys.time()
}

message("Fetching Imperial metadata…")
meta <- openair::importMeta(source = "imperial", all = TRUE)
if (!"code" %in% names(meta)) stop("importMeta imperial: no 'code' column")

meta_london <- meta %>%
  filter(
    latitude >= LONDON_LAT[1], latitude <= LONDON_LAT[2],
    longitude >= LONDON_LNG[1], longitude <= LONDON_LNG[2],
    !toupper(code) %in% EXCLUDED_SITE_CODES
  ) %>%
  distinct(code, .keep_all = TRUE)

message(sprintf("  London Imperial sites: %d", nrow(meta_london)))

candidates <- list()
skipped <- list(closed = 0L, opened_after_2021 = 0L, ungrouped = 0L, industrial_rural = 0L)
ungrouped <- character()

for (i in seq_len(nrow(meta_london))) {
  row <- meta_london[i, ]
  if (!is_currently_open(row)) {
    skipped$closed <- skipped$closed + 1L
    next
  }
  oy <- opening_year(row)
  if (is.na(oy) || oy > 2021) {
    skipped$opened_after_2021 <- skipped$opened_after_2021 + 1L
    next
  }
  st <- as.character(row$site_type %||% "")
  if (grepl("industrial|rural|indoor", st, ignore.case = TRUE)) {
    skipped$industrial_rural <- skipped$industrial_rural + 1L
    next
  }
  grp <- group_site_type(st)
  if (is.na(grp)) {
    skipped$ungrouped <- skipped$ungrouped + 1L
    ungrouped <- c(ungrouped, st)
    next
  }
  candidates[[length(candidates) + 1L]] <- list(
    site_code = toupper(as.character(row$code)),
    name = as.character(row$site %||% row$code),
    site_type = st,
    group = grp,
    opening_year = oy,
    latitude = as.numeric(row$latitude),
    longitude = as.numeric(row$longitude)
  )
}

message(sprintf(
  "  metadata candidates: %d (skipped closed %d, open>2021 %d, industrial/rural %d, ungrouped %d)",
  length(candidates), skipped$closed, skipped$opened_after_2021,
  skipped$industrial_rural, skipped$ungrouped
))
if (length(ungrouped)) {
  message("  ungrouped site_type: ", paste(unique(ungrouped), collapse = ", "))
}

fetch_imperial_pm25 <- function(site_code, years) {
  tryCatch(
    openair::importImperial(
      site = tolower(site_code),
      year = years,
      pollutant = "pm25",
      meta = FALSE
    ),
    error = function(e) {
      warning("Failed ", site_code, " ", paste(years, collapse = ","), ": ", e$message)
      NULL
    }
  )
}

year_stats_from_df <- function(df) {
  poll_col <- get_pm25_column(df)
  if (is.null(poll_col) || is.null(df) || nrow(df) == 0) {
    return(NULL)
  }
  values <- suppressWarnings(as.numeric(df[[poll_col]]))
  values[!is.finite(values)] <- NA_real_
  dates <- as.POSIXct(df$date, tz = "GMT")
  years <- as.integer(format(dates, "%Y", tz = "GMT"))
  stats <- list()
  for (y in unique(years)) {
    series <- values[years == y]
    valid <- sum(!is.na(series))
    exp_h <- if (y == CURRENT_YEAR) expected_hours_ytd(y) else expected_hours(y)
    mean_val <- if (valid > 0) round(mean(series, na.rm = TRUE), 2) else NA_real_
    stats[[as.character(y)]] <- list(
      valid = valid,
      coverage = valid / exp_h,
      mean = mean_val
    )
  }
  stats
}

sites <- list()
skipped$no_pm25 <- 0L
skipped$incomplete_years <- 0L
skipped$import_failed <- 0L

# Pass 1: 2025 screen so we do not download six years for NO2-only sites.
SCREEN_YEAR <- 2025L
remaining_years <- setdiff(ALL_YEARS, SCREEN_YEAR)

for (i in seq_along(candidates)) {
  cand <- candidates[[i]]
  site_code <- cand$site_code
  message(sprintf("  [%d/%d] screen %s %s %d…", i, length(candidates), site_code, cand$group, SCREEN_YEAR))
  df_screen <- fetch_imperial_pm25(site_code, SCREEN_YEAR)
  stats <- year_stats_from_df(df_screen)
  if (is.null(stats) || is.null(stats[[as.character(SCREEN_YEAR)]])) {
    skipped$no_pm25 <- skipped$no_pm25 + 1L
    next
  }
  screen <- stats[[as.character(SCREEN_YEAR)]]
  if (is.na(screen$coverage) || screen$coverage < MIN_COVERAGE) {
    skipped$incomplete_years <- skipped$incomplete_years + 1L
    next
  }

  message(sprintf("    PM2.5 ok (%.0f%% in %d) — fetching %s", 100 * screen$coverage, SCREEN_YEAR, paste(remaining_years, collapse = ",")))
  df_rest <- fetch_imperial_pm25(site_code, remaining_years)
  rest_stats <- year_stats_from_df(df_rest)
  if (!is.null(rest_stats)) {
    for (nm in names(rest_stats)) stats[[nm]] <- rest_stats[[nm]]
  }

  annual <- list()
  coverage <- list()
  complete_ok <- TRUE
  for (y in ALL_YEARS) {
    st <- stats[[as.character(y)]]
    cov <- if (is.null(st)) 0 else st$coverage
    coverage[[as.character(y)]] <- unbox(round(cov, 4))
    if (y %in% COMPLETE_YEARS) {
      if (is.null(st) || cov < MIN_COVERAGE || is.na(st$mean)) {
        complete_ok <- FALSE
      } else {
        annual[[as.character(y)]] <- unbox(st$mean)
      }
    } else if (!is.null(st) && is.finite(st$mean)) {
      annual[[as.character(y)]] <- unbox(st$mean)
    }
  }
  if (!complete_ok) {
    skipped$incomplete_years <- skipped$incomplete_years + 1L
    next
  }
  sites[[length(sites) + 1L]] <- list(
    siteCode = unbox(site_code),
    name = unbox(cand$name),
    classification = unbox(cand$site_type),
    group = unbox(cand$group),
    startYear = unbox(cand$opening_year),
    source = unbox("openair::importImperial"),
    coverage = coverage,
    annual = annual
  )
}

n_road <- sum(vapply(sites, function(s) identical(s$group, "Roadside"), logical(1)))
n_bg <- sum(vapply(sites, function(s) identical(s$group, "Background"), logical(1)))

payload <- list(
  generatedAt = unbox(format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")),
  network = unbox("laqn-imperial"),
  source = unbox("openair::importImperial pm25; >=75% hourly capture in 2021–2025"),
  completeYears = COMPLETE_YEARS,
  years = ALL_YEARS,
  minCoverage = unbox(MIN_COVERAGE),
  skipped = lapply(skipped, unbox),
  nSites = unbox(length(sites)),
  nRoadside = unbox(n_road),
  nBackground = unbox(n_bg),
  sites = sites
)

write_json(payload, OUT_PATH, auto_unbox = FALSE, pretty = TRUE, null = "null", digits = NA)
message(sprintf(
  "Wrote %s (%d roadside, %d background)",
  OUT_PATH, n_road, n_bg
))
