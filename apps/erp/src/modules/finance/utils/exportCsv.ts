import { FinancialTransaction, ResidentFinancialSummary } from "@/types";
import { formatIndianDate } from "./dateUtils";

/**
 * Escapes a cell value for CSV output:
 * - Wraps strings containing commas, quotes, or newlines in quotes.
 * - Escapes internal quotes by doubling them (" -> "").
 * - Sanitizes against formula injection by prepending a single quote if the first character
 *   is an execution trigger (=, +, -, @, tab, return).
 */
export function sanitizeCsvCell(value: any): string {
  if (value === null || value === undefined) {
    return "";
  }

  let str = String(value);

  // Formula injection mitigation (OWASP CSV Injection guidelines)
  const firstChar = str.charAt(0);
  if (["=", "+", "-", "@", "\t", "\r"].includes(firstChar)) {
    str = `'${str}`;
  }

  // Escape double quotes and enclose if special characters exist
  if (str.includes('"') || str.includes(",") || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Initiates a browser CSV download with UTF-8 BOM for Microsoft Excel compatibility.
 */
function downloadCsvBlob(csvContent: string, filename: string): void {
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Exports cashbook transactions to CSV.
 */
export function exportCashbookToCsv(
  transactions: FinancialTransaction[],
  filters: {
    startDate?: string;
    endDate?: string;
    type?: string;
    searchQuery?: string;
  }
): void {
  const headers = [
    "Transaction ID",
    "Date",
    "Type",
    "Status",
    "Party / Resident / Vendor",
    "Room Number",
    "Payment Method",
    "Reference / UTR",
    "Billing Period",
    "Description",
    "Amount (INR)",
    "Created By",
    "Created At",
  ];

  const rows = transactions.map((tx) => [
    sanitizeCsvCell(tx.id),
    sanitizeCsvCell(tx.transactionDate),
    sanitizeCsvCell(tx.transactionType),
    sanitizeCsvCell(tx.status),
    sanitizeCsvCell(tx.residentName || tx.payeeVendor || "General Operations"),
    sanitizeCsvCell(tx.roomNumber || ""),
    sanitizeCsvCell(tx.paymentMethod || ""),
    sanitizeCsvCell(tx.referenceNumber || ""),
    sanitizeCsvCell(tx.billingPeriod || ""),
    sanitizeCsvCell(tx.description || ""),
    sanitizeCsvCell(tx.amount),
    sanitizeCsvCell(tx.createdByName || tx.createdBy),
    sanitizeCsvCell(tx.createdAt),
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map((r) => r.join(",")),
  ].join("\r\n");

  const start = filters.startDate || "all";
  const end = filters.endDate || "all";
  const filename = `ravinarayan_cashbook_${start}_to_${end}.csv`;

  downloadCsvBlob(csvContent, filename);
}

/**
 * Exports a resident financial statement to CSV.
 */
export function exportResidentStatementToCsv(summary: ResidentFinancialSummary): void {
  const metaRows = [
    ["Ravinarayan PG Guesthouse — Resident Financial Statement"],
    ["Generated At", new Date().toLocaleString("en-IN")],
    ["Resident Name", summary.fullName],
    ["Resident ID", summary.residentId],
    ["Phone", summary.phone],
    ["Current Room", summary.currentRoomNumber ? `Room ${summary.currentRoomNumber}` : "Not Assigned"],
    [],
    ["FINANCIAL SUMMARY"],
    ["Total Rent Charges Billed (INR)", summary.totalRentCharges],
    ["Total Rent Paid (INR)", summary.totalRentPaid],
    ["Current Outstanding Rent Balance (INR)", summary.outstandingRentBalance],
    ["Total Security Deposit Held (INR)", summary.totalSecurityDepositHeld],
    [],
    ["TRANSACTION LEDGER HISTORY"],
    [
      "Date",
      "Transaction ID",
      "Type",
      "Status",
      "Billing Period",
      "Payment Method",
      "Reference",
      "Description",
      "Amount (INR)",
    ],
  ];

  const txRows = (summary.transactions || []).map((t) => [
    sanitizeCsvCell(t.transactionDate),
    sanitizeCsvCell(t.id),
    sanitizeCsvCell(t.transactionType),
    sanitizeCsvCell(t.status),
    sanitizeCsvCell(t.billingPeriod || ""),
    sanitizeCsvCell(t.paymentMethod || ""),
    sanitizeCsvCell(t.referenceNumber || ""),
    sanitizeCsvCell(t.description || ""),
    sanitizeCsvCell(t.amount),
  ]);

  const csvContent = [
    ...metaRows.map((r) => r.map(sanitizeCsvCell).join(",")),
    ...txRows.map((r) => r.join(",")),
  ].join("\r\n");

  const safeName = summary.fullName.toLowerCase().replace(/[^a-z0-9]/g, "_");
  const filename = `ravinarayan_statement_${safeName}_${summary.residentId}.csv`;

  downloadCsvBlob(csvContent, filename);
}
