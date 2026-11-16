"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { StatStrip } from "@/components/ui/kit";
import {
  Calendar,
  Lock,
  Unlock,
  AlertTriangle,
  CheckCircle,
  FileText,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Layers,
  Truck,
  RotateCcw,
  Save,
  Check,
  ChevronRight,
  ShieldAlert,
} from "lucide-react";
import {
  DailyClosingPreview,
  DailyClosingRecord,
  ClosingDivision,
  PaymentMethod,
} from "@/types";
import { toLocalDateString } from "../utils/dateUtils";
import { useHasPermission } from "@/components/auth/CurrentUserContext";
import { formatNumberIN, formatMoney } from "@/lib/format";
import { useIsPhone } from "@/components/app/m";
import { ClosingMobile } from "../mobile/FinanceMobileMore";
import { ClosingDesktop } from "./ClosingDesktop";
import { exportClosingsCsv } from "../utils/financeCsv";
import { useErpQuery, invalidateErpCache } from "@/lib/cache/erpDataCache";
import { closingPreviewQuery, usePrefetchChoices } from "@/lib/pageQueries";
import { Download } from "lucide-react";

interface DailyClosingViewProps {
  onMutationSuccess?: (message: string) => void;
  onMutationError?: (message: string) => void;
}

export function DailyClosingView({
  onMutationSuccess,
  onMutationError,
}: DailyClosingViewProps) {
  // Draft, finalize and reopen require finance.manage (Owner); the server enforces this too.
  const canManageFinance = useHasPermission("finance.manage");
  const phone = useIsPhone();
  const [selectedDate, setSelectedDate] = useState<string>(toLocalDateString());
  const [selectedDivision, setSelectedDivision] = useState<ClosingDivision>("COMBINED");
  const [historicalClosings, setHistoricalClosings] = useState<DailyClosingRecord[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form input states
  const [actualCashCounted, setActualCashCounted] = useState<string>("");
  const [actualBankVerified, setActualBankVerified] = useState<string>("");
  const [discrepancyReason, setDiscrepancyReason] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  // Reopen modal states
  const [isReopenModalOpen, setIsReopenModalOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");

  // The day's closing for the chosen part of the business, from the shared cache: All, PG and
  // Tiffin are all loaded (the other two quietly, right after the first), so switching between
  // them shows the figures at once.
  const previewDef = closingPreviewQuery(selectedDate, selectedDivision);
  const previewQuery = useErpQuery<DailyClosingPreview>(previewDef.key, previewDef.fetcher, { ttl: previewDef.ttl, tags: previewDef.tags });
  // While another day loads, the previous figures stay (dimmed) instead of blanking.
  const preview: DailyClosingPreview | null = previewQuery.data ?? null;
  const currentPreview = previewQuery.isSwitching ? null : preview;
  const isLoadingPreview = previewQuery.isLoading && !preview;
  usePrefetchChoices(
    (["COMBINED", "PG", "TIFFIN"] as ClosingDivision[]).filter((d) => d !== selectedDivision).map((d) => closingPreviewQuery(selectedDate, d)),
    Boolean(currentPreview)
  );
  useEffect(() => {
    if (previewQuery.error && onMutationError) onMutationError(previewQuery.error.message || "Failed to load closing preview.");
  }, [previewQuery.error, onMutationError]);

  // The form starts from the saved closing (or the expected cash) when the day or the part of the
  // business changes, and after a save; a quiet refresh never overwrites what is being typed.
  const prefilledFor = useRef<string | null>(null);
  useEffect(() => {
    const preview = currentPreview;
    if (!preview || prefilledFor.current === previewDef.key) return;
    prefilledFor.current = previewDef.key;
    if (preview.existingClosing) {
      const ec = preview.existingClosing;
      setActualCashCounted(ec.actualCashCounted !== null ? String(ec.actualCashCounted) : "");
      setActualBankVerified(ec.actualBankVerified !== null ? String(ec.actualBankVerified) : "");
      setDiscrepancyReason(ec.discrepancyReason || "");
      setNotes(ec.notes || "");
    } else {
      setActualCashCounted(String(preview.expectedCashBalance));
      setActualBankVerified("");
      setDiscrepancyReason("");
      setNotes("");
    }
  }, [currentPreview, previewDef.key]);

  // After a draft, finalize or reopen: every division's figures for the day are loaded again.
  const reloadPreview = useCallback(async () => {
    prefilledFor.current = null;
    invalidateErpCache(["closing"]);
  }, []);

  // Load historical closings
  const fetchHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const res = await fetch("/api/finance/closing", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setHistoricalClosings(data.closings || []);
      }
    } catch (err: any) {
      console.error("Error loading closing history:", err);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Derived calculation
  const parsedCashCounted = actualCashCounted.trim() === "" ? NaN : Number(actualCashCounted);
  const parsedBankVerified = actualBankVerified.trim() === "" ? null : Number(actualBankVerified);
  const cashDiscrepancy = !isNaN(parsedCashCounted) && preview
    ? parsedCashCounted - preview.expectedCashBalance
    : 0;

  const isFinalized = preview?.existingClosing?.status === "FINALIZED";

  // Handle Save Draft
  const handleSaveDraft = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/finance/closing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "draft",
          closingDate: selectedDate,
          division: selectedDivision,
          actualCashCounted: !isNaN(parsedCashCounted) ? parsedCashCounted : null,
          actualBankVerified: parsedBankVerified,
          discrepancyReason: discrepancyReason.trim() || null,
          notes: notes.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save closing draft.");

      if (onMutationSuccess) onMutationSuccess("Daily closing draft saved successfully.");
      await reloadPreview();
      await fetchHistory();
    } catch (err: any) {
      if (onMutationError) onMutationError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Finalize
  const handleFinalize = async () => {
    if (isNaN(parsedCashCounted) || parsedCashCounted < 0) {
      if (onMutationError) onMutationError("Please enter a valid, non-negative cash count.");
      return;
    }

    if (cashDiscrepancy !== 0 && (!discrepancyReason.trim() || discrepancyReason.trim().length < 5)) {
      if (onMutationError) {
        onMutationError("A justification reason of at least 5 characters is mandatory when closing with a cash discrepancy.");
      }
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/finance/closing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "finalize",
          closingDate: selectedDate,
          division: selectedDivision,
          actualCashCounted: parsedCashCounted,
          actualBankVerified: parsedBankVerified,
          discrepancyReason: discrepancyReason.trim() || null,
          notes: notes.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to finalize closing.");

      if (onMutationSuccess) onMutationSuccess(`Daily closing for ${selectedDate} finalized and locked successfully.`);
      await reloadPreview();
      await fetchHistory();
    } catch (err: any) {
      if (onMutationError) onMutationError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Reopen
  const handleReopen = async () => {
    if (!preview?.existingClosing?.id) return;
    if (!reopenReason.trim() || reopenReason.trim().length < 5) {
      if (onMutationError) onMutationError("A reason of at least 5 characters is required to reopen.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/finance/closing/${preview.existingClosing.id}/reopen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reopenReason.trim() }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reopen closing.");

      if (onMutationSuccess) onMutationSuccess(`Daily closing for ${selectedDate} has been reopened.`);
      setIsReopenModalOpen(false);
      setReopenReason("");
      await reloadPreview();
      await fetchHistory();
    } catch (err: any) {
      if (onMutationError) onMutationError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // One set of state and actions; the phone app and the laptop each have their own layout.
  const View = phone ? ClosingMobile : ClosingDesktop;
  return (
    <View
        date={selectedDate}
        setDate={setSelectedDate}
        division={selectedDivision}
        setDivision={setSelectedDivision}
        preview={preview}
        loading={isLoadingPreview}
        history={historicalClosings}
        canManage={canManageFinance}
        isFinalized={isFinalized}
        cash={actualCashCounted}
        setCash={setActualCashCounted}
        bank={actualBankVerified}
        setBank={setActualBankVerified}
        reason={discrepancyReason}
        setReason={setDiscrepancyReason}
        notes={notes}
        setNotes={setNotes}
        difference={cashDiscrepancy}
        submitting={isSubmitting}
        onDraft={handleSaveDraft}
        onFinalize={handleFinalize}
        onReopen={handleReopen}
        reopenOpen={isReopenModalOpen}
        setReopenOpen={setIsReopenModalOpen}
        reopenReason={reopenReason}
        setReopenReason={setReopenReason}
      />
  );
}
