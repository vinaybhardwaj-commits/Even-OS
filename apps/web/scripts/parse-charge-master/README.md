# BV3.2.A — Charge Master PDF Parser Probe Harness

Standalone TypeScript probes that convert EHRC's 3 Charge Master PDFs into
import-ready CSV + JSON.  These feed BV3.2.B's server-side importer
(`chargeMaster.uploadTariff`).

## PDFs covered

| PDF                              | Rows  | Output CSV                 | Schema table                     |
| -------------------------------- | ----- | -------------------------- | -------------------------------- |
| Tariff List - Room Rent.pdf      |     7 | `out/room-rent.csv`        | `charge_master_room`             |
| Tariff List - Investigations.pdf | 2,115 | `out/investigations.csv`   | `charge_master_item` + `_price`  |
| Tariff List-Packages.pdf         |   201 | `out/packages.csv`         | `charge_master_package` + price  |

LABOR_OBS and ER_OBS room classes are not in the PDF — they stay at the
BV3.1.E seeded ₹0 default until Finance provides pricing.

## Running

All scripts run from `apps/web`:

```
pnpm exec tsx scripts/parse-charge-master/parse-room-rent.ts
pnpm exec tsx scripts/parse-charge-master/parse-investigations.ts
pnpm exec tsx scripts/parse-charge-master/parse-packages.ts
```

Each script:

1. runs `pdftotext -layout -nopgbrk` on its source PDF
2. walks the columnar text with a parser tuned to that PDF's shape
3. writes `out/<name>.json` + `out/<name>.csv` + `out/<name>.rejects.csv`
   (rejects file only written when there are rejects)
4. prints a one-line summary banner + dept breakdown

Exit code is non-zero if row counts fall below a sanity threshold.

## Shared files

- `types.ts` — `ParsedRoomRow`, `ParsedInvestigationRow`, `ParsedPackageRow`,
  `ParseReject`, `ParseSummary`, plus `CLASS_CODES` and `ROOM_CLASSES`.
- `util.ts` — `pdfToText`, `writeCsv`, `writeJson`, `toInt`, `logSummary`.

## Pre-approved product decisions (V, 22 Apr 2026)

- **Q1 — Package per-class prices**: Option B. Packages get a child table
  `charge_master_package_price` (one row per class code per package).  For
  now the CSV emits `price_general`/`price_semi_pvt`/`price_pvt` columns
  plus `price_icu`/`price_suite` (which stay blank because those classes
  are Open Billing for every current package).
- **Q2 — Upload format**: CSV-only via the BV3.2.B importer UI.  No direct
  PDF upload.  These probe scripts are the PDF→CSV bridge.
- **Q3 — "All ICU" column in Investigations**: duplicates to BOTH `ICU`
  and `HDU` class price rows at the same value.
- **Q4 — Service Type → dept_code**: `Accident → ER`, `Administrative → ADMIN`,
  `Orthopeadic → ORTHO` (PDF spelling).  Everything else passes through
  in uppercase-short form (e.g. `Cardiology → CARDIO`, `Radiology → RADIO`).

## Package CSV quirks

- `icu_days` column is a flag (0 or 1), not a price. It lives in a separate
  `duration_days`-family field on `charge_master_package`.
- `suite_open_billing` is true for every current row — every package is
  "Open Billing" for SUITE, which is why `price_suite` is blank.
- ICU is also open-billing when `icu_days=1`, which is why `price_icu`
  is blank for those rows too.

## Known PDF artifacts (accepted)

- GEN-PKG-064 "ISTHMECTOMY" wraps across a line break in the PDF; we join
  with a space so it reads "ISTH MECTOMY".  Can be normalized in BV3.2.B.
- A handful of package names have a stray `-ENT PKG` / `- OBG - PKG` tail
  that is part of the original tariff sheet's naming — preserved verbatim.

## Regenerating after PDF updates

Just re-run.  `out/` is `.gitignore`d so re-runs don't churn the repo.
If row counts drop below the script's sanity threshold, the script exits
non-zero — review the rejects CSV before trusting the CSV output.
