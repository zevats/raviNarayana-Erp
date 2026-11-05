import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../database/db";
import { requirePermission } from "../authorization/authorize";
import { recordAuditEventAsync } from "../audit/audit";
import { previewResidentSettlement, finalizeResidentCheckoutSettlement } from "./residentSettlementService";
import { AuthenticatedUser, FinalizeSettlementInput, ResidentSettlementRecord } from "@/types";

/**
 * Checkout settlements that need the Owner (migration 0018). A Manager prepares the settlement —
 * deductions, deposit applied to rent, refund — and sends it for approval; nothing is posted and
 * the resident's stay stays open. The Owner approves (the settlement is then finalized exactly as if
 * the Owner had entered it, with every live check repeated) or rejects it with a reason.
 */

export interface SettlementProposal {
  id: string;
  residentId: string;
  residentName: string;
  roomNumber: string | null;
  stayId: string;
  checkoutDate: string;
  refundAmount: number;
  deductionsAmount: number;
  depositAppliedAmount: number;
  payload: FinalizeSettlementInput;
  status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  proposedByName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  settlementId: string | null;
  createdAt: string;
}

function mapRow(r: any): SettlementProposal {
  return {
    id: r.id,
    residentId: r.resident_id,
    residentName: r.resident_name,
    roomNumber: r.room_number ?? null,
    stayId: r.stay_id,
    checkoutDate: r.checkout_date,
    refundAmount: Number(r.refund_amount),
    deductionsAmount: Number(r.deductions_amount),
    depositAppliedAmount: Number(r.deposit_applied_amount),
    payload: JSON.parse(r.payload),
    status: r.status,
    proposedByName: r.proposed_by_name ?? null,
    decidedByName: r.decided_by_name ?? null,
    decidedAt: r.decided_at ?? null,
    decisionNote: r.decision_note ?? null,
    settlementId: r.settlement_id ?? null,
    createdAt: r.created_at,
  };
}

const SELECT = `
  SELECT p.*, res.full_name AS resident_name, rm.room_number, a.full_name AS proposed_by_name, b.full_name AS decided_by_name
  FROM settlement_proposals p
  JOIN residents res ON res.id = p.resident_id
  JOIN resident_stays s ON s.id = p.stay_id
  JOIN rooms rm ON rm.id = s.room_id
  LEFT JOIN staff_users a ON a.id = p.proposed_by
  LEFT JOIN staff_users b ON b.id = p.decided_by`;

/** Sends a prepared settlement to the Owner. Checks it against the live balance first. */
export async function proposeResidentSettlement(
  actor: AuthenticatedUser,
  input: FinalizeSettlementInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<SettlementProposal> {
  requirePermission(actor, "residents.manage", { ip: clientIp, targetId: input.residentId, action: "resident.settlement_proposed" });
  const db = asyncDb ?? getAsyncDb();
  const preview = await previewResidentSettlement(actor, input.residentId, input.checkOutDate, db);
  const deductions = (input.deductions || []).map((d) => ({ reason: String(d.reason || "").trim(), amount: Number(d.amount) }));
  for (const d of deductions) {
    if (!d.reason) throw new Error("Every deduction must have a documented reason.");
    if (!Number.isInteger(d.amount) || d.amount <= 0) throw new Error(`Deduction amount for '${d.reason}' must be a positive integer.`);
  }
  const totalDeductions = deductions.reduce((a, d) => a + d.amount, 0);
  const applied = Math.max(0, Number(input.depositAppliedAmount) || 0);
  const refund = Math.max(0, Number(input.refundAmount) || 0);
  if (!Number.isInteger(applied) || !Number.isInteger(refund)) throw new Error("Amounts must be whole rupees.");
  if (totalDeductions > preview.totalDepositHeld) throw new Error(`Deductions (₹${totalDeductions}) cannot exceed the deposit held (₹${preview.totalDepositHeld}).`);
  const available = preview.totalDepositHeld - totalDeductions;
  if (applied > available) throw new Error(`Deposit applied (₹${applied}) cannot exceed the deposit left after deductions (₹${available}).`);
  if (applied > preview.outstandingRentDue) throw new Error(`Deposit applied (₹${applied}) cannot exceed the rent due (₹${preview.outstandingRentDue}).`);
  if (refund > available - applied) throw new Error(`Refund (₹${refund}) cannot exceed the deposit left (₹${available - applied}).`);
  if (refund > 0 && !input.refundPaymentMethod) throw new Error("Choose how the refund will be paid.");

  const payload: FinalizeSettlementInput = {
    residentId: preview.residentId,
    checkOutDate: input.checkOutDate,
    deductions,
    depositAppliedAmount: applied,
    refundAmount: refund,
    refundPaymentMethod: input.refundPaymentMethod,
    refundReference: input.refundReference,
    remainingPayableAmount: input.remainingPayableAmount,
    paymentMethod: input.paymentMethod,
    paymentReference: input.paymentReference,
    notes: input.notes,
  };
  const id = `stp_${crypto.randomUUID()}`;
  const at = new Date().toISOString();
  await db.transaction(async (tx) => {
    const pending = await tx.queryOne("SELECT id FROM settlement_proposals WHERE stay_id = ? AND status = 'PENDING'", [preview.stayId]);
    if (pending) throw new Error("A settlement for this resident is already waiting for the Owner's approval.");
    await tx.execute(
      `INSERT INTO settlement_proposals (id, resident_id, stay_id, checkout_date, payload, refund_amount, deductions_amount, deposit_applied_amount, status, proposed_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)`,
      [id, preview.residentId, preview.stayId, input.checkOutDate, JSON.stringify(payload), refund, totalDeductions, applied, actor.id, at, at]
    );
    await recordAuditEventAsync({
      actorId: actor.id, actorUsername: actor.username, action: "resident.settlement_proposed", targetType: "resident", targetId: preview.residentId,
      metadata: { proposalId: id, stayId: preview.stayId, checkOutDate: input.checkOutDate, refund, deductions: totalDeductions, depositApplied: applied }, ipAddress: clientIp,
    }, tx);
  });
  return (await getProposal(db, id))!;
}

async function getProposal(db: AsyncDb, id: string): Promise<SettlementProposal | null> {
  const row = await db.queryOne<any>(`${SELECT} WHERE p.id = ?`, [id]);
  return row ? mapRow(row) : null;
}

export async function listSettlementProposals(actor: AuthenticatedUser, status: SettlementProposal["status"] | "ALL" = "PENDING", asyncDb?: AsyncDb): Promise<SettlementProposal[]> {
  requirePermission(actor, "residents.read");
  const db = asyncDb ?? getAsyncDb();
  const rows = status === "ALL"
    ? await db.query<any>(`${SELECT} ORDER BY p.created_at DESC LIMIT 100`)
    : await db.query<any>(`${SELECT} WHERE p.status = ? ORDER BY p.created_at ASC LIMIT 100`, [status]);
  return rows.map(mapRow);
}

/** The Owner approves: the settlement is finalized now, with every live check repeated. */
export async function approveSettlementProposal(
  actor: AuthenticatedUser,
  id: string,
  note?: string,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<ResidentSettlementRecord> {
  requirePermission(actor, "finance.manage", { ip: clientIp, targetId: id, action: "resident.settlement_approved" });
  const db = asyncDb ?? getAsyncDb();
  const proposal = await getProposal(db, id);
  if (!proposal) throw new Error("Settlement proposal not found.");
  if (proposal.status !== "PENDING") throw new Error(`This proposal was already ${proposal.status.toLowerCase()}.`);
  const settlement = await finalizeResidentCheckoutSettlement(
    actor,
    {
      ...proposal.payload,
      notes: [proposal.payload.notes, `Prepared by ${proposal.proposedByName || "the Manager"}; approved by ${actor.fullName}${note?.trim() ? `: ${note.trim()}` : ""}.`].filter(Boolean).join(" "),
      approvingProposalId: id,
      approvalNote: note,
    },
    clientIp,
    db
  );
  await recordAuditEventAsync({
    actorId: actor.id, actorUsername: actor.username, action: "resident.settlement_approved", targetType: "resident", targetId: proposal.residentId,
    metadata: { proposalId: id, settlementId: settlement.id, refund: proposal.refundAmount, deductions: proposal.deductionsAmount, depositApplied: proposal.depositAppliedAmount, note: note || null },
    ipAddress: clientIp,
  }, db);
  return settlement;
}

/** The Owner rejects (reason required), or the person who sent it withdraws it. Nothing is posted. */
export async function closeSettlementProposal(
  actor: AuthenticatedUser,
  id: string,
  decision: "REJECTED" | "WITHDRAWN",
  note: string | undefined,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<SettlementProposal> {
  const db = asyncDb ?? getAsyncDb();
  if (decision === "REJECTED") {
    requirePermission(actor, "finance.manage", { ip: clientIp, targetId: id, action: "resident.settlement_rejected" });
    if (!note || note.trim().length < 3) throw new Error("Say why the settlement is rejected.");
  } else {
    requirePermission(actor, "residents.manage", { ip: clientIp, targetId: id, action: "resident.settlement_withdrawn" });
  }
  const at = new Date().toISOString();
  await db.transaction(async (tx) => {
    const row = await tx.queryOne<any>(`SELECT * FROM settlement_proposals WHERE id = ?${tx.isPostgres ? " FOR UPDATE" : ""}`, [id]);
    if (!row) throw new Error("Settlement proposal not found.");
    if (row.status !== "PENDING") throw new Error(`This proposal was already ${String(row.status).toLowerCase()}.`);
    if (decision === "WITHDRAWN" && row.proposed_by !== actor.id && actor.role !== "SUPER_ADMIN") {
      throw new Error("Only the person who sent it can withdraw this proposal.");
    }
    await tx.execute(
      "UPDATE settlement_proposals SET status = ?, decided_by = ?, decided_at = ?, decision_note = ?, updated_at = ? WHERE id = ? AND status = 'PENDING'",
      [decision, actor.id, at, note?.trim() || null, at, id]
    );
    await recordAuditEventAsync({
      actorId: actor.id, actorUsername: actor.username, action: decision === "REJECTED" ? "resident.settlement_rejected" : "resident.settlement_withdrawn",
      targetType: "resident", targetId: row.resident_id, metadata: { proposalId: id, note: note || null }, ipAddress: clientIp,
    }, tx);
  });
  return (await getProposal(db, id))!;
}
