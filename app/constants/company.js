export const COMPANY = Object.freeze({
  legalName: "Popeye GmbH",
  street: "Erkrather Str. 343",
  zip: "40231",
  city: "Düsseldorf",
  country: "Deutschland",
  phone: "+49 (0) 211 15812527",
  email: "service@dawayo.de",
  website: "dawayo.de",
  registerCourt: "Amtsgericht Düsseldorf",
  registerNumber: "HRB 84725",
  managingDirectors: ["Soonchan Kwon"],
  vatId: "DE 3208 90998",
  taxNumber: "106 5721 6110",
  eori: "DE 83 5767 6549 86380",
  logoUrl: "https://www.orderprintertemplates.com/api/v1/logos/1198814f74a2758ff45b?v=1778853839",
});

const BANK_BASE = Object.freeze({
  accountHolder: "Popeye GmbH",
  bankName: "Stadtsparkasse Düsseldorf",
  bic: "DUSSDEDDXXX",
});

/** General / B2C account (Endkunden) */
export const COMPANY_BANK_B2C = Object.freeze({
  ...BANK_BASE,
  label: "Allgemein / B2C",
  iban: "DE41 3005 0110 1008 3808 24",
});

/** Wholesale / B2B account (Großhandel) */
export const COMPANY_BANK_B2B = Object.freeze({
  ...BANK_BASE,
  label: "Großhandel / B2B",
  iban: "DE76 3005 0110 1008 0519 46",
});

/** Backwards-compatible default account (B2C). */
export const COMPANY_BANK = COMPANY_BANK_B2C;

export function getCompanyBankAccount(isB2B) {
  return isB2B ? COMPANY_BANK_B2B : COMPANY_BANK_B2C;
}

export const PAYMENT_REFERENCE_PREFIX = "Bestellung-Nr";

export const INVOICE_NUMBER_PREFIX = "RE";
export const INVOICE_NUMBER_PAD_LENGTH = 5;
export const INVOICE_TIMEZONE = "Europe/Berlin";
export const INVOICE_SNAPSHOT_MAX_BYTES = 500_000;
