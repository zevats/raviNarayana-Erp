/**
 * GSTIN (Goods and Services Tax Identification Number) Format & Checksum Validator.
 *
 * Implements authoritative structural parsing, state-code verification, PAN validation,
 * and Modulo 36 Luhn-variant checksum calculation according to statutory GST Council rules.
 *
 * NOTE: Mathematical and structural validation verifies that the GSTIN string adheres
 * to the statutory format and checksum formula. It does NOT query the GST Common Portal
 * (gst.gov.in) to verify active taxpayer registration, business status, or return compliance.
 */

export const GST_CHECKSUM_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * 2-digit state and union territory codes defined under the Indian GST system.
 */
export const GST_STATE_CODES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "25": "Daman and Diu",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "28": "Andhra Pradesh (Old)",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
  "99": "Centre Jurisdiction",
};

/**
 * Valid 4th character of an Indian PAN, denoting the legal constitution/status of the taxpayer.
 */
export const VALID_PAN_ENTITY_TYPES: Record<string, string> = {
  C: "Company",
  P: "Person / Individual",
  H: "Hindu Undivided Family (HUF)",
  F: "Firm / Limited Liability Partnership",
  A: "Association of Persons (AOP)",
  T: "Trust",
  B: "Body of Individuals (BOI)",
  L: "Local Authority",
  J: "Artificial Juridical Person",
  G: "Government Agency",
};

/**
 * Standard 15-character GSTIN structure:
 * - Group 1 (State code): 2 digits
 * - Group 2 (PAN): 5 uppercase letters + 4 digits + 1 uppercase letter
 * - Group 3 (Entity number): 1-9 or A-Z
 * - Group 4 (Default char): 'Z'
 * - Group 5 (Checksum): 0-9 or A-Z
 */
export const GSTIN_REGEX = /^([0-9]{2})([A-Z]{5}[0-9]{4}[A-Z])([1-9A-Z])(Z)([0-9A-Z])$/;

export const GSTIN_VALIDATION_DISCLAIMER =
  "Format and checksum validation establishes structural conformity with the statutory 15-character GSTIN specification. It does not establish taxpayer registration status or active GSTIN validity on the GST Common Portal.";

export interface ParsedGstin {
  stateCode: string;
  stateName: string;
  pan: string;
  panEntityType: string;
  panEntityDescription: string;
  entityCode: string;
  defaultChar: string;
  checksumChar: string;
}

export interface GstinValidationResult {
  isValid: boolean;
  normalizedGstin: string;
  error?: string;
  structureValid: boolean;
  checksumValid: boolean;
  expectedChecksum?: string;
  actualChecksum?: string;
  parsed?: ParsedGstin;
  disclaimer: string;
}

export interface GstinValidationOptions {
  fieldName?: string;
  checkChecksum?: boolean;
  expectedStateCode?: string;
}

/**
 * Computes the 15th character checksum using the official GST Council Modulo 36 Luhn-variant algorithm.
 *
 * Algorithm specification:
 * - Base character set: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ' (indices 0 to 35).
 * - For i = 0 to 13:
 *     factor = (i % 2 === 0) ? 1 : 2;
 *     product = charValue * factor;
 *     quotient = Math.floor(product / 36);
 *     remainder = product % 36;
 *     sum += quotient + remainder;
 * - checksumIndex = (36 - (sum % 36)) % 36;
 * - checksumChar = CHARS[checksumIndex].
 */
export function computeGstinChecksum(gstin14: string): string {
  if (typeof gstin14 !== "string" || gstin14.length < 14) {
    throw new Error("Cannot compute GSTIN checksum: Input must be at least 14 characters long.");
  }

  const clean14 = gstin14.trim().toUpperCase().slice(0, 14);
  let sum = 0;

  for (let i = 0; i < 14; i++) {
    const char = clean14[i];
    const val = GST_CHECKSUM_CHARS.indexOf(char);
    if (val === -1) {
      throw new Error(`Cannot compute GSTIN checksum: Invalid character '${char}' at index ${i}.`);
    }

    const factor = i % 2 === 0 ? 1 : 2;
    const product = val * factor;
    const quotient = Math.floor(product / 36);
    const remainder = product % 36;
    sum += quotient + remainder;
  }

  const checkCode = (36 - (sum % 36)) % 36;
  return GST_CHECKSUM_CHARS[checkCode];
}

/**
 * Authoritatively validates a GSTIN string against structural, state code, PAN entity,
 * and Modulo 36 checksum requirements.
 */
export function validateGstin(
  rawInput: unknown,
  options?: GstinValidationOptions
): GstinValidationResult {
  const fieldName = options?.fieldName || "GSTIN";
  const checkChecksum = options?.checkChecksum !== false; // default true
  const expectedStateCode = options?.expectedStateCode?.trim();

  // 1. Basic Type and Emptiness Checks
  if (rawInput === null || rawInput === undefined) {
    return {
      isValid: false,
      normalizedGstin: "",
      error: `${fieldName} is required.`,
      structureValid: false,
      checksumValid: false,
      disclaimer: GSTIN_VALIDATION_DISCLAIMER,
    };
  }

  if (typeof rawInput !== "string") {
    return {
      isValid: false,
      normalizedGstin: "",
      error: `${fieldName} must be a string value.`,
      structureValid: false,
      checksumValid: false,
      disclaimer: GSTIN_VALIDATION_DISCLAIMER,
    };
  }

  const trimmed = rawInput.trim();
  if (trimmed.length === 0) {
    return {
      isValid: false,
      normalizedGstin: "",
      error: `${fieldName} cannot be empty.`,
      structureValid: false,
      checksumValid: false,
      disclaimer: GSTIN_VALIDATION_DISCLAIMER,
    };
  }

  const normalized = trimmed.toUpperCase();

  // 2. Length Validation
  if (normalized.length !== 15) {
    return {
      isValid: false,
      normalizedGstin: normalized,
      error: `${fieldName} must be exactly 15 characters long (got ${normalized.length}).`,
      structureValid: false,
      checksumValid: false,
      disclaimer: GSTIN_VALIDATION_DISCLAIMER,
    };
  }

  // 3. Permitted Characters Check (Only alphanumeric [0-9A-Z])
  if (!/^[0-9A-Z]{15}$/.test(normalized)) {
    return {
      isValid: false,
      normalizedGstin: normalized,
      error: `${fieldName} contains invalid characters. GSTIN must contain only uppercase alphanumeric characters (0-9, A-Z).`,
      structureValid: false,
      checksumValid: false,
      disclaimer: GSTIN_VALIDATION_DISCLAIMER,
    };
  }

  // 4. State Code Segment Validation (Characters 1-2)
  const stateCode = normalized.slice(0, 2);
  if (!/^[0-9]{2}$/.test(stateCode)) {
    return {
      isValid: false,
      normalizedGstin: normalized,
      error: `${fieldName} state code prefix must be 2 digits (got '${stateCode}').`,
      structureValid: false,
      checksumValid: false,
      disclaimer: GSTIN_VALIDATION_DISCLAIMER,
    };
  }

  const stateName = GST_STATE_CODES[stateCode];
  if (!stateName) {
    return {
      isValid: false,
      normalizedGstin: normalized,
      error: `Invalid state code '${stateCode}' in ${fieldName}. State code must be a valid 2-digit Indian State or Union Territory code (01-38, 97, 99).`,
      structureValid: false,
      checksumValid: false,
      disclaimer: GSTIN_VALIDATION_DISCLAIMER,
    };
  }

  if (expectedStateCode && stateCode !== expectedStateCode) {
    return {
      isValid: false,
      normalizedGstin: normalized,
      error: `${fieldName} state code '${stateCode}' does not match expected state code '${expectedStateCode}'.`,
      structureValid: false,
      checksumValid: false,
      disclaimer: GSTIN_VALIDATION_DISCLAIMER,
    };
  }

  // 5. PAN Segment Validation (Characters 3-12)
  const pan = normalized.slice(2, 12);
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
    return {
      isValid: false,
      normalizedGstin: normalized,
      error: `Invalid PAN structure '${pan}' in ${fieldName} (characters 3-12). Standard Indian PAN format requires 5 letters, 4 digits, and 1 letter.`,
      structureValid: false,
      checksumValid: false,
      disclaimer: GSTIN_VALIDATION_DISCLAIMER,
    };
  }

  const panEntityType = pan[3];
  const panEntityDescription = VALID_PAN_ENTITY_TYPES[panEntityType];
  if (!panEntityDescription) {
    return {
      isValid: false,
      normalizedGstin: normalized,
      error: `Invalid PAN entity type character '${panEntityType}' in ${fieldName} (character 4). Must be one of C, P, H, F, A, T, B, L, J, G.`,
      structureValid: false,
      checksumValid: false,
      disclaimer: GSTIN_VALIDATION_DISCLAIMER,
    };
  }

  // 6. Entity Registration Code (Character 13)
  const entityCode = normalized[12];
  if (!/^[1-9A-Z]$/.test(entityCode)) {
    return {
      isValid: false,
      normalizedGstin: normalized,
      error: `Invalid entity code '${entityCode}' in ${fieldName} (character 13). Must be a digit 1-9 or uppercase letter A-Z.`,
      structureValid: false,
      checksumValid: false,
      disclaimer: GSTIN_VALIDATION_DISCLAIMER,
    };
  }

  // 7. Default Character Segment (Character 14)
  const defaultChar = normalized[13];
  if (defaultChar !== "Z") {
    return {
      isValid: false,
      normalizedGstin: normalized,
      error: `Invalid default character '${defaultChar}' in ${fieldName} (character 14). Standard Indian GSTIN requires character 14 to be 'Z'.`,
      structureValid: false,
      checksumValid: false,
      disclaimer: GSTIN_VALIDATION_DISCLAIMER,
    };
  }

  // 8. Checksum Character Segment (Character 15)
  const actualChecksum = normalized[14];
  const gstin14 = normalized.slice(0, 14);
  const expectedChecksum = computeGstinChecksum(gstin14);
  const checksumMatches = actualChecksum === expectedChecksum;

  if (checkChecksum && !checksumMatches) {
    return {
      isValid: false,
      normalizedGstin: normalized,
      error: `${fieldName} checksum verification failed: character 15 is '${actualChecksum}', but expected Modulo-36 checksum character is '${expectedChecksum}'.`,
      structureValid: true,
      checksumValid: false,
      expectedChecksum,
      actualChecksum,
      disclaimer: GSTIN_VALIDATION_DISCLAIMER,
    };
  }

  const parsed: ParsedGstin = {
    stateCode,
    stateName,
    pan,
    panEntityType,
    panEntityDescription,
    entityCode,
    defaultChar,
    checksumChar: actualChecksum,
  };

  return {
    isValid: true,
    normalizedGstin: normalized,
    structureValid: true,
    checksumValid: checksumMatches,
    expectedChecksum,
    actualChecksum,
    parsed,
    disclaimer: GSTIN_VALIDATION_DISCLAIMER,
  };
}

/**
 * Asserts that a GSTIN is valid, throwing a formatted Error if validation fails.
 * Returns the normalized (uppercase, trimmed) GSTIN string on success.
 */
export function assertValidGstin(
  rawInput: unknown,
  options?: GstinValidationOptions
): string {
  const result = validateGstin(rawInput, options);
  if (!result.isValid) {
    throw new Error(result.error);
  }
  return result.normalizedGstin;
}

/**
 * Returns true if the provided value is a valid GSTIN format.
 */
export function isValidGstin(
  rawInput: unknown,
  options?: { checkChecksum?: boolean }
): boolean {
  return validateGstin(rawInput, options).isValid;
}
