"use client";

import { friendlyError } from "@/lib/friendlyError";
import { AppSelect } from "@/components/forms/AppSelect";
import React, { useState, useEffect } from "react";
import {
  FileText,
  Upload,
  Download,
  Eye,
  Archive,
  AlertCircle,
  CheckCircle2,
  Clock,
  ShieldCheck,
  FileCheck,
  X,
  FileImage,
} from "lucide-react";
import { DocumentAttachment, DocumentCategory, DOCUMENT_CATEGORY_LABELS } from "@/types";

interface ResidentKycSectionProps {
  residentId: string;
  residentName: string;
  canManage: boolean;
}

export function ResidentKycSection({
  residentId,
  residentName,
  canManage,
}: ResidentKycSectionProps) {
  const [documents, setDocuments] = useState<DocumentAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Upload Modal State
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadCategory, setUploadCategory] = useState<DocumentCategory>("RESIDENT_KYC");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadNotes, setUploadNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  // Archival confirmation state
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/documents?residentId=${residentId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load KYC documents.");
      setDocuments(data.documents || []);
    } catch (err: any) {
      setError(friendlyError(err.message || "Failed to load documents."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (residentId) {
      fetchDocuments();
    }
  }, [residentId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadError(null);
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.size > 5 * 1024 * 1024) {
        setUploadError("File size exceeds maximum limit of 5.00 MB.");
        setSelectedFile(null);
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setUploadError("Please select a document file to upload.");
      return;
    }

    setUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("category", uploadCategory);
      formData.append("residentId", residentId);
      if (uploadNotes.trim()) {
        formData.append("notes", uploadNotes.trim());
      }

      const res = await fetch("/api/documents", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to upload document.");
      }

      setUploadSuccess(`Uploaded "${data.document.displayFilename}" successfully.`);
      setSelectedFile(null);
      setUploadNotes("");
      setIsUploadOpen(false);
      await fetchDocuments();
      setTimeout(() => setUploadSuccess(null), 4000);
    } catch (err: any) {
      setUploadError(err.message || "An error occurred while uploading document.");
    } finally {
      setUploading(false);
    }
  };

  const handleArchive = async (docId: string) => {
    try {
      setArchivingId(docId);
      const res = await fetch(`/api/documents/${docId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: "Archived via Resident KYC Management" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to archive document.");
      await fetchDocuments();
    } catch (err: any) {
      alert(err.message || "Failed to archive document.");
    } finally {
      setArchivingId(null);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="space-y-3">
      {/* Header bar */}
      <div className="flex items-center justify-between pb-2 border-b border-[#8E9F89]/20">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#1A2E20]" />
          <h4 className="text-xs font-semibold text-[#1A2E20] uppercase tracking-wider">
            KYC &amp; Government ID Documents ({documents.length})
          </h4>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setIsUploadOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1 bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs font-medium rounded-xl transition-all shadow-xs"
          >
            <Upload className="w-3.5 h-3.5" />
            Attach Document
          </button>
        )}
      </div>

      {uploadSuccess && (
        <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{uploadSuccess}</span>
        </div>
      )}

      {error && (
        <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Documents List */}
      {loading ? (
        <div className="py-6 text-center text-xs text-[#5A6C5E]">
          Loading verified KYC documents...
        </div>
      ) : documents.length === 0 ? (
        <div className="p-4 bg-stone-50 border border-stone-200 rounded-2xl text-center space-y-1">
          <FileText className="w-6 h-6 text-stone-400 mx-auto" />
          <p className="text-xs font-medium text-stone-600">No KYC documents attached</p>
          <p className="text-[11px] text-stone-500">
            Government ID, Aadhaar, address proofs or lease clearance slips can be securely stored.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => {
            const isPdf = doc.mimeType === "application/pdf";
            const isActive = doc.status === "ACTIVE";

            return (
              <div
                key={doc.id}
                className={`p-3 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                  isActive
                    ? "bg-white border-[#8E9F89]/30 hover:border-[#1A2E20]/40 shadow-2xs"
                    : "bg-stone-50 border-stone-200 opacity-75"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      isPdf ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {isPdf ? <FileText className="w-4 h-4" /> : <FileImage className="w-4 h-4" />}
                  </div>

                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-[#1A2E20] truncate">
                        {doc.displayFilename}
                      </span>
                      <span className="px-2 py-0.5 bg-[#1A2E20]/10 text-[#1A2E20] text-[10px] font-medium rounded-full">
                        {DOCUMENT_CATEGORY_LABELS[doc.category] || doc.category}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 text-[9px] font-bold uppercase rounded-md ${
                          doc.status === "ACTIVE"
                            ? "bg-emerald-100 text-emerald-800"
                            : doc.status === "SUPERSEDED"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-stone-200 text-stone-700"
                        }`}
                      >
                        {doc.status}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-[10px] text-[#5A6C5E]">
                      <span>{formatFileSize(doc.fileSize)}</span>
                      <span>&bull;</span>
                      <span>{doc.createdAt.slice(0, 10)}</span>
                      {doc.uploadedByName && (
                        <>
                          <span>&bull;</span>
                          <span>Uploaded by {doc.uploadedByName}</span>
                        </>
                      )}
                    </div>
                    {doc.notes && (
                      <p className="text-[10px] text-stone-500 italic">{doc.notes}</p>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <a
                    href={`/api/documents/${doc.id}/download?disposition=inline`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 hover:bg-stone-100 rounded-lg text-[#1A2E20] transition-colors"
                    title="View Document"
                  >
                    <Eye className="w-4 h-4" />
                  </a>
                  <a
                    href={`/api/documents/${doc.id}/download?disposition=attachment`}
                    download={doc.displayFilename}
                    className="p-1.5 hover:bg-stone-100 rounded-lg text-[#1A2E20] transition-colors"
                    title="Download Document"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                  {canManage && isActive && (
                    <button
                      type="button"
                      disabled={archivingId === doc.id}
                      onClick={() => {
                        if (confirm(`Archive document "${doc.displayFilename}"?`)) {
                          handleArchive(doc.id);
                        }
                      }}
                      className="p-1.5 hover:bg-stone-100 rounded-lg text-stone-400 hover:text-stone-700 transition-colors"
                      title="Archive Document"
                    >
                      <Archive className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload Document Modal */}
      {isUploadOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-[#8E9F89]/30 max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#8E9F89]/20">
              <div className="flex items-center gap-2">
                <FileCheck className="w-5 h-5 text-[#1A2E20]" />
                <h3 className="font-serif text-lg font-normal text-[#1A2E20]">
                  Attach KYC Document
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsUploadOpen(false);
                  setSelectedFile(null);
                  setUploadError(null);
                }}
                className="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center text-stone-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="space-y-3.5 text-xs">
              {uploadError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{uploadError}</span>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-medium text-[#1A2E20] mb-1">
                  Resident Profile
                </label>
                <input
                  type="text"
                  disabled
                  value={residentName}
                  className="w-full px-3 py-2 bg-stone-100 border border-stone-200 rounded-xl text-stone-600"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#1A2E20] mb-1">
                  Document Category
                </label>
                <AppSelect
                  value={uploadCategory}
                  onChange={(e) => setUploadCategory(e.target.value as DocumentCategory)}
                  className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#1A2E20]/20"
                >
                  <option value="RESIDENT_KYC">Resident Identity (Aadhaar / Voter ID / Passport)</option>
                  <option value="RESIDENT_ADDRESS_PROOF">Address Proof (Utility Bill / Agreement)</option>
                  <option value="OPERATIONAL_ATTACHMENT">Other Authorized Attachment</option>
                </AppSelect>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#1A2E20] mb-1">
                  File Upload (PDF, JPEG, PNG, WebP &le; 5.00 MB)
                </label>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  onChange={handleFileChange}
                  className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl file:mr-3 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-[11px] file:bg-[#1A2E20]/10 file:text-[#1A2E20] hover:file:bg-[#1A2E20]/20"
                />
                {selectedFile && (
                  <p className="mt-1 text-[10px] text-emerald-700">
                    Selected: {selectedFile.name} ({formatFileSize(selectedFile.size)})
                  </p>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#1A2E20] mb-1">
                  Notes / Verification Details (Optional)
                </label>
                <textarea
                  rows={2}
                  value={uploadNotes}
                  onChange={(e) => setUploadNotes(e.target.value)}
                  placeholder="e.g. Aadhaar card verified against original"
                  className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#1A2E20]/20"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsUploadOpen(false);
                    setSelectedFile(null);
                    setUploadError(null);
                  }}
                  className="px-4 py-2 border border-stone-300 text-stone-700 rounded-xl font-medium hover:bg-stone-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading || !selectedFile}
                  className="px-4 py-2 bg-[#1A2E20] hover:bg-[#263B2D] text-white rounded-xl font-medium transition-colors disabled:opacity-50"
                >
                  {uploading ? "Verifying & Uploading..." : "Upload & Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
