#!/usr/bin/env Rscript
# Monthly PM2.5 means for the locked LAQN cohort (sitecodes from laqn-site-years.json).
# Hourly openair::importImperial → calendar-month mean if ≥50% of hours present.

suppressPackageStartupMessages({
  library(openair)
  library(jsonlite)
})

ROOT <- if (file.exists("R/fetch_laqn_pm25_monthly.R")) {
  normalizePath(".")
} else {
  normalizePath(file.path(".."))
}
COHORT_PATH <- file.path(ROOT, "data", "laqn-site-years.json")
OUT_PATH <- file.path(ROOT, "data", "laqn-site-months.json")
dir.create(file.path(ROOT, "data"), showWarnings = FALSE, recursive = TRUE)

START_YEAR <- 2021L
MIN_COVERAGE <- 0.5

scalar <- function(x) {
  if (is.null(x) || length(x) == 0) return(NA)
  if (is.list(x)) return(scalar(x[[1]]))
  if (length(x) > 1) x[[1]] else x
}

unwrap_chr <- function(x) as.character(scalar(x))

last_complete_month <- function() {
  now <- as.POSIXlt(Sys.time(), tz = "GMT")
  if (now$mon == 0L) {
    list(year = now$year + 1899L, month = 12L)
  } else {
    list(year = now$year + 1900L, month = now$mon)
  }
}

month_keys <- function(end_year, end_month) {
  keys <- character()
  for (y in START_YEAR:end_year) {
    max_m <- if (y == end_year) end_month else 12L
    for (m in 1:max_m) {
      keys <- c(keys, sprintf("%d-%02d", y, m))
    }
  }
  keys
}

expected_hours_month <- function(year_val, month_val) {
  start <- as.POSIXct(sprintf("%d-%02d-01 00:00:00", year_val, month_val), tz = "GMT")
  if (month_val == 12L) {
    end <- as.POSIXct(sprintf("%d-01-01 00:00:00", year_val + 1L), tz = "GMT")
  } else {
    end <- as.POSIXct(sprintf("%d-%02d-01 00:00:00", year_val, month_val + 1L), tz = "GMT")
  }
  as.integer(as.numeric(difftime(end, start, units = "hours")))
}

get_pm25_column <- function(df) {
  if (is.null(df) || nrow(df) == 0) return(NULL)
  cols <- names(df)
  idx <- which(tolower(cols) %in% c("pm2.5", "pm25"))
  if (length(idx) > 0) cols[idx[1]] else NULL
}

if (!file.exists(COHORT_PATH)) {
  stop("Missing ", COHORT_PATH, " — run npm run fetch:laqn first")
}

cohort <- fromJSON(COHORT_PATH, simplifyDataFrame = FALSE)
end <- last_complete_month()
years <- START_YEAR:end$year
keys <- month_keys(end$year, end$month)

message(sprintf(
  "LAQN monthly for %d cohort sites, %d–%d-%02d",
  length(cohort$sites), START_YEAR, end$year, end$month
))

sites <- list()

for (i in seq_along(cohort$sites)) {
  cand <- cohort$sites[[i]]
  site_code <- toupper(unwrap_chr(cand$siteCode))
  grp <- unwrap_chr(cand$group)
  message(sprintf("  [%d/%d] %s %s…", i, length(cohort$sites), site_code, grp))
  df <- tryCatch(
    openair::importImperial(
      site = tolower(site_code),
      year = years,
      pollutant = "pm25",
      meta = FALSE
    ),
    error = function(e) {
      warning("Failed ", site_code, ": ", e$message)
      NULL
    }
  )
  poll_col <- get_pm25_column(df)
  monthly <- list()
  coverage <- list()
  if (!is.null(df) && !is.null(poll_col) && nrow(df) > 0) {
    values <- suppressWarnings(as.numeric(df[[poll_col]]))
    values[!is.finite(values)] <- NA_real_
    dates <- as.POSIXct(df$date, tz = "GMT")
    ym <- format(dates, "%Y-%m", tz = "GMT")
    for (key in keys) {
      series <- values[ym == key]
      valid <- sum(!is.na(series))
      y <- as.integer(substr(key, 1, 4))
      m <- as.integer(substr(key, 6, 7))
      exp_h <- expected_hours_month(y, m)
      cov <- if (exp_h > 0) valid / exp_h else 0
      coverage[[key]] <- unbox(round(cov, 4))
      if (valid > 0 && cov >= MIN_COVERAGE) {
        monthly[[key]] <- unbox(round(mean(series, na.rm = TRUE), 2))
      }
    }
  }
  sites[[length(sites) + 1L]] <- list(
    siteCode = unbox(site_code),
    name = unbox(unwrap_chr(cand$name)),
    classification = unbox(unwrap_chr(cand$classification)),
    group = unbox(grp),
    source = unbox("openair::importImperial"),
    coverage = coverage,
    monthly = monthly
  )
  message(sprintf("    %d months", length(monthly)))
}

payload <- list(
  generatedAt = unbox(format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")),
  network = unbox("laqn-imperial"),
  source = unbox("openair::importImperial pm25; site-month mean if ≥50% of hours"),
  minCoverage = unbox(MIN_COVERAGE),
  months = keys,
  nSites = unbox(length(sites)),
  sites = sites
)

write_json(payload, OUT_PATH, auto_unbox = FALSE, pretty = TRUE, null = "null", digits = NA)
message(sprintf("Wrote %s (%d sites, %d months)", OUT_PATH, length(sites), length(keys)))
