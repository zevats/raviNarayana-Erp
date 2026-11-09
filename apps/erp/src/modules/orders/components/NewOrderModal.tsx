"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { X, Truck, Utensils, Search, Plus, Minus, Check, AlertCircle, RotateCcw, User, MapPin, ChevronLeft, ArrowRight } from "lucide-react";
import { TiffinCustomer, TiffinProduct, MealType, BusinessOrderType } from "@/types";
import { businessToday } from "@/lib/businessDate";
import { useErpQuery } from "@/lib/cache/erpDataCache";

interface NewOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after the server confirmed the order, with the message to show; the dialog then closes. */
  onOrderCreated: (message: string) => void;
  defaultDate?: string;
}

type Step = 1 | 2 | 3;
const STEPS: Array<{ n: Step; label: string; short: string }> = [
  { n: 1, label: "Customer", short: "Customer" },
  { n: 2, label: "Items", short: "Items" },
  { n: 3, label: "Schedule & confirm", short: "Confirm" },
];
const MEALS: Array<{ v: MealType; label: string }> = [
  { v: "BREAKFAST", label: "Breakfast" },
  { v: "LUNCH", label: "Lunch" },
  { v: "DINNER", label: "Dinner" },
];
const CATEGORY_LABEL: Record<string, string> = { STANDARD_MEAL: "Meal", SPECIAL: "Special", EXTRA: "Extra", BEVERAGE: "Beverage" };
const categoryLabel = (c: string) => CATEGORY_LABEL[c] || c.charAt(0) + c.slice(1).toLowerCase().replace(/_/g, " ");
const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;

// Colours come from the section theme (orange in Orders): ink for text, ink-2 for secondary text
// (readable in bright light), accent for the one primary action and the selected state.
const INK = "text-[var(--rn-ink)]";
const INK2 = "text-[var(--rn-ink-2)]";
const FIELD =
  "w-full h-11 px-3.5 text-[14px] rounded-xl border border-[var(--rn-line)] bg-white text-[var(--rn-ink)] placeholder:text-[var(--rn-ink-3)] focus:outline-none";
const LABEL = "block text-[13px] font-semibold text-[var(--rn-ink-2)] mb-1.5";

/** Segmented control: a quiet track; the chosen option gets a white surface and a 2px accent edge. */
function Segmented<T extends string>({ value, options, onChange, label, size = "md" }: {
  value: T;
  options: Array<{ v: T; label: React.ReactNode; hint?: string }>;
  onChange: (v: T) => void;
  label: string;
  size?: "md" | "lg";
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-1.5 p-1.5 rounded-[18px] bg-[var(--rn-accent-tint)] border border-[var(--rn-line)]" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.v)}
            className={`min-w-0 rounded-xl text-left transition-colors ${size === "lg" ? "px-3.5 py-3" : "px-3 py-2.5 text-center"} ${
              on ? "bg-white shadow-[0_0_0_2px_var(--rn-accent)]" : "hover:bg-white/70"
            }`}
          >
            <span className={`block text-[14px] font-semibold ${on ? INK : INK2}`}>{o.label}</span>
            {o.hint && <span className={`block text-[12.5px] mt-0.5 ${INK2}`}>{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function NewOrderModal({ isOpen, onClose, onOrderCreated, defaultDate }: NewOrderModalProps) {
  const [step, setStep] = useState<Step>(1);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Order type
  const [orderType, setOrderType] = useState<BusinessOrderType>("DELIVERY");

  // Customer selection
  const [customerMode, setCustomerMode] = useState<"EXISTING" | "NEW">("EXISTING");
  const [customers, setCustomers] = useState<TiffinCustomer[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<TiffinCustomer | null>(null);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [newCustomerAddress, setNewCustomerAddress] = useState("");

  // Duplicate phone detection state
  const [duplicateCustomer, setDuplicateCustomer] = useState<TiffinCustomer | null>(null);
  const [isCheckingPhone, setIsCheckingPhone] = useState(false);

  // Customer order history (Repeat orders)
  const [orderHistory, setOrderHistory] = useState<Array<any>>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Menu & Cart
  const [products, setProducts] = useState<TiffinProduct[]>([]);
  const [menuSearch, setMenuSearch] = useState("");
  const [cart, setCart] = useState<Record<string, { product: TiffinProduct; quantity: number }>>({});

  // Operational Metadata
  const [serviceDate, setServiceDate] = useState(defaultDate || businessToday());
  const [mealType, setMealType] = useState<MealType>("LUNCH");
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "UPI">("CASH");
  const [notes, setNotes] = useState("");

  // State guards
  const [isSubmitting, setIsSubmitting] = useState(false);
  // One idempotency key per order draft: a retry after a lost response or a double click is
  // recognised by the server as the same order. A new key is issued only after a success.
  const [draftKey, setDraftKey] = useState(() => `ord_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
  const [reuseNotice, setReuseNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Each opening starts a clean draft at step 1: no customer, phone, address, items or notes carried
  // over from the previous order (order type, meal and date stay as last chosen for fast repeat entry).
  // A failed save does not close the form, so the entered data is kept for a retry.
  useEffect(() => {
    if (!isOpen) return;
    setStep(1);
    setCustomerSearch("");
    setSelectedCustomer(null);
    setNewCustomerName("");
    setNewCustomerPhone("");
    setNewCustomerAddress("");
    setDuplicateCustomer(null);
    setOrderHistory([]);
    setCart({});
    setMenuSearch("");
    setNotes("");
    setErrorMessage(null);
    setReuseNotice(null);
  }, [isOpen]);

  // Escape closes the form (unless an order is being saved).
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSubmitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, isSubmitting, onClose]);

  // A new step starts at its top.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [step]);

  // Menu and the first customers come from the shared cache: fetched once while the Orders page
  // is open (before the dialog is first used), reused on every opening, refreshed after changes.
  const productsQuery = useErpQuery<TiffinProduct[]>(
    "/api/tiffin/products?status=ACTIVE",
    async () => {
      const res = await fetch("/api/tiffin/products?status=ACTIVE");
      if (!res.ok) throw new Error("Could not load the menu.");
      const data = await res.json();
      return Array.isArray(data.products) ? data.products : [];
    },
    { ttl: 60000, tags: ["products", "tiffin_products"] }
  );
  const customersQuery = useErpQuery<TiffinCustomer[]>(
    "/api/tiffin/customers?status=ACTIVE&limit=20",
    async () => {
      const res = await fetch("/api/tiffin/customers?status=ACTIVE&limit=20");
      if (!res.ok) throw new Error("Could not load customers.");
      const data = await res.json();
      return Array.isArray(data.customers) ? data.customers : [];
    },
    { ttl: 30000, tags: ["customers", "tiffin_customers"] }
  );
  useEffect(() => {
    // Monthly subscription packages are not order items.
    if (productsQuery.data) setProducts(productsQuery.data.filter((p) => p.billingUnit !== "PER_MONTH"));
  }, [productsQuery.data]);
  useEffect(() => {
    if (isOpen && customersQuery.data) setCustomers(customersQuery.data);
  }, [isOpen, customersQuery.data]);

  // Search existing customers
  useEffect(() => {
    if (!isOpen || customerMode !== "EXISTING" || customerSearch.length < 2) return;
    const t = setTimeout(() => {
      fetch(`/api/tiffin/customers?search=${encodeURIComponent(customerSearch)}&limit=10`)
        .then((res) => (res.ok ? res.json() : { customers: [] }))
        .then((data) => {
          if (data.customers) setCustomers(data.customers);
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [customerSearch, customerMode, isOpen]);

  // Check for duplicate customer phone when in NEW customer mode
  useEffect(() => {
    if (!isOpen || customerMode !== "NEW") {
      setDuplicateCustomer(null);
      return;
    }
    const cleanPhone = newCustomerPhone.trim().replace(/[\s\-\.\(\)]/g, "");
    if (cleanPhone.length < 7) {
      setDuplicateCustomer(null);
      return;
    }

    const t = setTimeout(() => {
      setIsCheckingPhone(true);
      fetch(`/api/tiffin/customers?search=${encodeURIComponent(cleanPhone)}&limit=5`)
        .then((res) => (res.ok ? res.json() : { customers: [] }))
        .then((data) => {
          if (data.customers && Array.isArray(data.customers)) {
            const match = data.customers.find((c: TiffinCustomer) => {
              const cClean = c.phone.replace(/[\s\-\.\(\)]/g, "");
              return cClean === cleanPhone || (cleanPhone.length >= 10 && cClean.endsWith(cleanPhone.slice(-10)));
            });
            setDuplicateCustomer(match || null);
          } else {
            setDuplicateCustomer(null);
          }
        })
        .catch(() => {
          setDuplicateCustomer(null);
        })
        .finally(() => {
          setIsCheckingPhone(false);
        });
    }, 300);

    return () => clearTimeout(t);
  }, [newCustomerPhone, customerMode, isOpen]);

  // Load repeat order history when customer is selected
  useEffect(() => {
    if (!selectedCustomer) {
      setOrderHistory([]);
      return;
    }
    setIsLoadingHistory(true);
    fetch(`/api/orders/history?customerId=${selectedCustomer.id}&phone=${encodeURIComponent(selectedCustomer.phone)}`)
      .then((res) => (res.ok ? res.json() : { history: [] }))
      .then((data) => {
        setOrderHistory(data.history || []);
      })
      .catch(() => {
        setOrderHistory([]);
      })
      .finally(() => {
        setIsLoadingHistory(false);
      });
  }, [selectedCustomer]);

  // Copies a previous order into a new draft (the old order is never changed). Items are matched to
  // today's menu and priced at today's menu price; items no longer on the menu are left out.
  const handleReuseOrder = (pastOrder: any) => {
    const newCart: Record<string, { product: TiffinProduct; quantity: number }> = {};
    const missing: string[] = [];
    if (Array.isArray(pastOrder.items)) {
      for (const item of pastOrder.items) {
        const matchingProd = products.find(
          (p) => (item.productId && p.id === item.productId) || p.name.toLowerCase() === String(item.productName).toLowerCase()
        );
        if (!matchingProd) {
          missing.push(item.productName);
          continue;
        }
        const prior = newCart[matchingProd.id]?.quantity || 0;
        newCart[matchingProd.id] = { product: matchingProd, quantity: prior + Number(item.quantity) };
      }
    }
    setReuseNotice(missing.length ? `Not on today's menu, left out: ${missing.join(", ")}.` : null);
    setCart(newCart);
    if (pastOrder.mealType) setMealType(pastOrder.mealType);
    if (pastOrder.deliveryAddress && selectedCustomer) {
      setNewCustomerAddress(pastOrder.deliveryAddress);
    }
    // The items are filled in: go straight to them to check the quantities.
    setErrorMessage(null);
    setStep(2);
  };

  // Quantity controllers
  const handleQuantityChange = (productId: string, delta: number) => {
    setCart((prev) => {
      const current = prev[productId];
      if (!current) {
        const prod = products.find((p) => p.id === productId);
        if (!prod || delta <= 0) return prev;
        return { ...prev, [productId]: { product: prod, quantity: delta } };
      }
      const newQty = current.quantity + delta;
      if (newQty <= 0) {
        const copy = { ...prev };
        delete copy[productId];
        return copy;
      }
      return { ...prev, [productId]: { ...current, quantity: newQty } };
    });
  };

  const handleManualQtyInput = (productId: string, val: string) => {
    const num = parseInt(val, 10);
    setCart((prev) => {
      const prod = prev[productId]?.product || products.find((p) => p.id === productId);
      if (!prod) return prev;
      if (isNaN(num) || num <= 0) {
        const copy = { ...prev };
        delete copy[productId];
        return copy;
      }
      return { ...prev, [productId]: { product: prod, quantity: num } };
    });
  };

  // Cart summary calculations
  const cartItems = useMemo(() => Object.values(cart), [cart]);
  const totalQuantity = useMemo(() => cartItems.reduce((s, it) => s + it.quantity, 0), [cartItems]);
  const totalAmount = useMemo(() => cartItems.reduce((s, it) => s + it.quantity * it.product.price, 0), [cartItems]);

  const filteredProducts = useMemo(() => {
    if (!menuSearch.trim()) return products;
    const q = menuSearch.toLowerCase().trim();
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
  }, [products, menuSearch]);

  /** What is wrong with the customer step, or null when it is complete. */
  const customerProblem = (): string | null => {
    if (orderType !== "DELIVERY") return null;
    if (customerMode === "EXISTING") {
      return selectedCustomer ? null : "Choose the delivery customer, or switch to New customer.";
    }
    if (duplicateCustomer) {
      return `This phone number already belongs to ${duplicateCustomer.fullName}. Use that customer or change the phone number.`;
    }
    if (newCustomerName.trim().length < 2) return "Customer name must be at least 2 characters.";
    if (newCustomerPhone.trim().length < 7) return "Enter the customer's phone number.";
    if (newCustomerAddress.trim().length < 5) return "Enter the delivery address (at least 5 characters).";
    return null;
  };

  const goTo = (target: Step) => {
    setErrorMessage(null);
    if (target > 1) {
      const p = customerProblem();
      if (p) {
        setStep(1);
        setErrorMessage(p);
        return;
      }
    }
    if (target > 2 && cartItems.length === 0) {
      setStep(2);
      setErrorMessage("Add at least one item.");
      return;
    }
    setStep(target);
  };

  // Form submission (Enter on steps 1 and 2 moves to the next step)
  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step < 3) {
      goTo((step + 1) as Step);
      return;
    }
    setErrorMessage(null);
    const problem = customerProblem();
    if (problem) {
      setStep(1);
      setErrorMessage(problem);
      return;
    }
    if (cartItems.length === 0) {
      setStep(2);
      setErrorMessage("Add at least one item.");
      return;
    }

    let customerName = "";
    let customerPhone = "";
    let deliveryAddress = "";
    let customerId: string | undefined = undefined;

    if (orderType === "DELIVERY") {
      if (customerMode === "EXISTING" && selectedCustomer) {
        customerId = selectedCustomer.id;
        customerName = selectedCustomer.fullName;
        customerPhone = selectedCustomer.phone;
        deliveryAddress = newCustomerAddress.trim() || selectedCustomer.deliveryAddress;
      } else {
        customerName = newCustomerName.trim();
        customerPhone = newCustomerPhone.trim();
        deliveryAddress = newCustomerAddress.trim();
      }
    } else {
      customerName = newCustomerName.trim() || "Walk-in Guest";
      customerPhone = newCustomerPhone.trim() || "";
    }

    setIsSubmitting(true);

    try {
      const itemsPayload = cartItems.map((it) => ({
        productId: it.product.id,
        productName: it.product.name,
        quantity: it.quantity,
        unitPrice: it.product.price,
      }));

      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderType,
          customerId,
          customerName,
          customerPhone,
          deliveryAddress: orderType === "DELIVERY" ? deliveryAddress : undefined,
          serviceDate,
          mealType,
          items: itemsPayload,
          paymentMethod: orderType === "DINE_IN" ? paymentMethod : undefined,
          paymentStatus: orderType === "DINE_IN" ? "PAID" : "PENDING",
          notes: notes.trim() || undefined,
          idempotencyKey: draftKey,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to confirm order.");

      const confirmed =
        orderType === "DELIVERY"
          ? data.order?.assignedToName
            ? `Delivery order confirmed! Assigned to ${data.order.assignedToName} for delivery.`
            : "Delivery order confirmed, but no active delivery staff account exists. Create or reactivate one in Staff Administration."
          : `Dine-in counter order confirmed (₹${totalAmount} collected via ${paymentMethod}).`;

      // Trigger cross-view instant refresh
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("erp:order_created"));
      }

      // Close as soon as the server confirmed; the page shows the confirmation. (A delayed close
      // left the button active with a new draft key, so a second click created a second order.)
      setDraftKey(`ord_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
      onOrderCreated(confirmed);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to submit order. Please check entered information.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const who =
    orderType === "DINE_IN"
      ? newCustomerName.trim() || "Walk-in guest"
      : customerMode === "EXISTING"
        ? selectedCustomer?.fullName || ""
        : newCustomerName.trim();
  const where = orderType === "DELIVERY" ? (customerMode === "EXISTING" ? newCustomerAddress.trim() || selectedCustomer?.deliveryAddress || "" : newCustomerAddress.trim()) : "";
  const noEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") e.preventDefault();
  };

  return (
    // Own scrim and panel (not the generic page-dialog styles): the panel never scrolls as a whole;
    // only its body does, between a fixed header and a fixed action bar.
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-[rgba(24,16,10,0.42)] backdrop-blur-[6px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <form
        onSubmit={handleSubmitOrder}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-order-title"
        className="w-full sm:max-w-[640px] h-[94dvh] sm:h-auto sm:max-h-[min(860px,92dvh)] flex flex-col overflow-hidden rounded-t-[26px] sm:rounded-[26px] border border-[var(--rn-line)] shadow-[0_30px_80px_-30px_rgba(40,20,10,0.55)]"
        style={{ backgroundColor: "#FBF8F4" }}
      >
        {/* Header: title and the three steps */}
        <header className="shrink-0 px-5 sm:px-6 pt-5 pb-4 bg-white border-b border-[var(--rn-line)]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={`text-[12px] font-semibold uppercase tracking-[0.1em] ${INK2}`}>Fast order entry</p>
              <h2 id="new-order-title" className={`text-[22px] leading-tight font-bold ${INK}`}>
                New tiffin order
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className={`w-11 h-11 -mr-2 -mt-1 rounded-full flex items-center justify-center ${INK2} hover:bg-[var(--rn-accent-tint)]`}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <ol className="mt-4 grid grid-cols-3 gap-2" aria-label="Steps">
            {STEPS.map((s) => {
              const done = s.n < step;
              const on = s.n === step;
              return (
                <li key={s.n} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => (s.n < step ? goTo(s.n) : s.n > step ? goTo(s.n) : undefined)}
                    aria-current={on ? "step" : undefined}
                    className="w-full min-w-0 text-left group"
                  >
                    <span className={`block h-1.5 rounded-full transition-colors ${on || done ? "bg-[var(--rn-accent)]" : "bg-[var(--rn-line)]"}`} />
                    <span className="mt-2 flex items-center gap-1.5 min-w-0">
                      <span
                        className={`w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold ${
                          done ? "bg-[var(--rn-accent)] text-white" : on ? "bg-[var(--rn-ink)] text-white" : "bg-[var(--rn-line)] text-[var(--rn-ink-2)]"
                        }`}
                      >
                        {done ? <Check className="w-3 h-3" /> : s.n}
                      </span>
                      <span className={`truncate text-[13px] ${on ? `font-bold ${INK}` : `font-medium ${INK2}`}`}>
                        <span className="sm:hidden">{s.short}</span>
                        <span className="hidden sm:inline">{s.label}</span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </header>

        {/* Body: the only part that scrolls, with room kept for the scrollbar */}
        <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain [scrollbar-gutter:stable] px-5 sm:px-6 py-5 space-y-5">
          {errorMessage && (
            <div role="alert" className="p-3.5 bg-[#FDECEA] border border-[#F2B8B0] text-[#8A1F12] text-[13.5px] rounded-[18px] flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {step === 1 && (
            <>
              <section className="space-y-2">
                <h3 className={`text-[15px] font-bold ${INK}`}>Order type</h3>
                <Segmented
                  label="Order type"
                  size="lg"
                  value={orderType}
                  onChange={(v) => {
                    setOrderType(v);
                    setErrorMessage(null);
                  }}
                  options={[
                    { v: "DELIVERY", label: <span className="flex items-center gap-2"><Truck className="w-4 h-4" />Delivery</span>, hint: "Doorstep tiffin delivery" },
                    { v: "DINE_IN", label: <span className="flex items-center gap-2"><Utensils className="w-4 h-4" />Dine in</span>, hint: "Walk-in counter sale" },
                  ]}
                />
              </section>

              {orderType === "DELIVERY" ? (
                <section className="space-y-3">
                  <h3 className={`text-[15px] font-bold ${INK}`}>Delivery customer</h3>
                  <Segmented
                    label="Customer"
                    value={customerMode}
                    onChange={(v) => {
                      setCustomerMode(v);
                      setSelectedCustomer(null);
                      setOrderHistory([]);
                      setErrorMessage(null);
                    }}
                    options={[
                      { v: "EXISTING", label: "Existing customer" },
                      { v: "NEW", label: "New customer" },
                    ]}
                  />

                  {customerMode === "EXISTING" ? (
                    !selectedCustomer ? (
                      <div className="space-y-2">
                        <div className="relative">
                          <Search className="pointer-events-none w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--rn-ink-3)]" />
                          <input
                            type="text"
                            placeholder="Search by name, phone or code"
                            aria-label="Search customers"
                            value={customerSearch}
                            onChange={(e) => setCustomerSearch(e.target.value)}
                            onKeyDown={noEnter}
                            className={`${FIELD} pl-10`}
                          />
                        </div>
                        <ul className="rounded-[18px] border border-[var(--rn-line)] bg-white divide-y divide-[var(--rn-line)] overflow-hidden" aria-label="Customers">
                          {customers.map((c) => (
                            <li key={c.id}>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedCustomer(c);
                                  setNewCustomerAddress(c.deliveryAddress || "");
                                  setErrorMessage(null);
                                }}
                                className="w-full min-h-[56px] px-4 py-2.5 text-left flex items-center justify-between gap-3 hover:bg-[var(--rn-accent-tint)] transition-colors"
                              >
                                <span className="min-w-0">
                                  <span className={`block text-[14.5px] font-semibold truncate ${INK}`}>{c.fullName}</span>
                                  <span className={`block text-[13px] truncate ${INK2}`}>
                                    <span className="tabular-nums">{c.phone}</span>
                                    {c.customerCode ? ` · ${c.customerCode}` : ""}
                                    {c.deliveryAddress ? ` · ${c.deliveryAddress}` : ""}
                                  </span>
                                </span>
                                <ArrowRight className="w-4 h-4 shrink-0 text-[var(--rn-ink-3)]" />
                              </button>
                            </li>
                          ))}
                          {customers.length === 0 && (
                            <li className={`px-4 py-5 text-center text-[13.5px] ${INK2}`}>No customer found. Try another search or add a new customer.</li>
                          )}
                        </ul>
                      </div>
                    ) : (
                      <div className="rounded-[18px] border border-[var(--rn-line)] bg-white p-4 space-y-3.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="w-10 h-10 rounded-full bg-[var(--rn-accent-tint)] flex items-center justify-center shrink-0">
                              <User className="w-5 h-5 text-[var(--rn-accent)]" />
                            </span>
                            <span className="min-w-0">
                              <span className={`block text-[15px] font-bold truncate ${INK}`}>{selectedCustomer.fullName}</span>
                              <span className={`block text-[13px] ${INK2}`}>
                                <span className="tabular-nums">{selectedCustomer.phone}</span>
                                {selectedCustomer.customerCode ? ` · ${selectedCustomer.customerCode}` : ""}
                              </span>
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedCustomer(null)}
                            className="h-10 px-3.5 rounded-full text-[13px] font-semibold text-[var(--rn-accent)] hover:bg-[var(--rn-accent-tint)]"
                          >
                            Change
                          </button>
                        </div>
                        <div>
                          <label htmlFor="no-address" className={LABEL}>Delivery address</label>
                          <input
                            id="no-address"
                            type="text"
                            value={newCustomerAddress}
                            onChange={(e) => setNewCustomerAddress(e.target.value)}
                            placeholder="Check or change the address for this order"
                            className={FIELD}
                          />
                        </div>

                        {isLoadingHistory && <p className={`text-[13px] ${INK2}`}>Loading the last order…</p>}
                        {orderHistory.length > 0 && (
                          <div className="pt-3 border-t border-[var(--rn-line)] space-y-2">
                            <p className={`flex items-center gap-1.5 text-[13.5px] font-semibold ${INK}`}>
                              <RotateCcw className="w-4 h-4 text-[var(--rn-accent)]" />
                              Repeat the last order
                            </p>
                            <ul className="space-y-1.5">
                              {orderHistory.slice(0, 1).map((past, idx) => (
                                <li key={past.orderId || idx} className="flex items-center justify-between gap-3 p-2.5 pl-3.5 rounded-xl bg-[var(--rn-accent-tint)]">
                                  <span className="min-w-0">
                                    <span className={`block text-[13.5px] font-medium truncate ${INK}`}>
                                      {past.items?.map((it: any) => `${it.quantity}× ${it.productName}`).join(", ")}
                                    </span>
                                    <span className={`block text-[12.5px] ${INK2}`}>
                                      ₹{past.totalAmount} · {past.orderDate}
                                    </span>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleReuseOrder(past)}
                                    className="h-10 px-4 rounded-full bg-white border border-[var(--rn-line)] text-[13px] font-semibold text-[var(--rn-ink)] hover:border-[var(--rn-accent)] shrink-0"
                                  >
                                    Reuse
                                  </button>
                                </li>
                              ))}
                            </ul>
                            <p className={`text-[12.5px] ${INK2}`}>Reuse copies the items into this order at today&apos;s prices. Past orders are not changed.</p>
                          </div>
                        )}
                      </div>
                    )
                  ) : (
                    <div className="space-y-3">
                      {duplicateCustomer && (
                        <div className="p-3.5 bg-[#FFF6E5] border border-[#F0CF8E] rounded-[18px] space-y-2.5">
                          <p className="flex items-center gap-2 text-[14px] font-bold text-[#6B4A06]">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            This phone number already exists
                          </p>
                          <div className="p-3 bg-white rounded-xl border border-[#F0CF8E]">
                            <p className={`text-[14px] font-semibold ${INK}`}>
                              {duplicateCustomer.fullName} <span className={`font-normal tabular-nums ${INK2}`}>({duplicateCustomer.phone})</span>
                            </p>
                            {duplicateCustomer.deliveryAddress && (
                              <p className={`mt-1 text-[13px] flex items-start gap-1 ${INK2}`}>
                                <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                {duplicateCustomer.deliveryAddress}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedCustomer(duplicateCustomer);
                                setNewCustomerAddress(duplicateCustomer.deliveryAddress || "");
                                setCustomerMode("EXISTING");
                                setDuplicateCustomer(null);
                                setErrorMessage(null);
                              }}
                              className="h-10 px-4 rounded-full bg-[var(--rn-accent)] text-white text-[13px] font-semibold"
                            >
                              Use this customer
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDuplicateCustomer(null);
                                setNewCustomerPhone("");
                              }}
                              className="h-10 px-4 rounded-full bg-white border border-[#F0CF8E] text-[13px] font-semibold text-[#6B4A06]"
                            >
                              Change the phone number
                            </button>
                          </div>
                        </div>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label htmlFor="no-name" className={LABEL}>Customer name *</label>
                          <input id="no-name" type="text" autoComplete="off" placeholder="Full name" value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} className={FIELD} />
                        </div>
                        <div>
                          <label htmlFor="no-phone" className={LABEL}>
                            Phone number * {isCheckingPhone && <span className="font-normal">(checking…)</span>}
                          </label>
                          <input
                            id="no-phone"
                            type="tel"
                            inputMode="tel"
                            placeholder="e.g. 9812345678"
                            value={newCustomerPhone}
                            onChange={(e) => setNewCustomerPhone(e.target.value)}
                            className={`${FIELD} ${duplicateCustomer ? "!border-[#E0A93A]" : ""}`}
                          />
                        </div>
                      </div>
                      <div>
                        <label htmlFor="no-new-address" className={LABEL}>Delivery address *</label>
                        <input id="no-new-address" type="text" placeholder="Flat, building, landmark, area" value={newCustomerAddress} onChange={(e) => setNewCustomerAddress(e.target.value)} className={FIELD} />
                      </div>
                    </div>
                  )}
                </section>
              ) : (
                <section className="space-y-3">
                  <h3 className={`text-[15px] font-bold ${INK}`}>
                    Guest <span className={`font-normal text-[13.5px] ${INK2}`}>(optional)</span>
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="no-guest" className={LABEL}>Name</label>
                      <input id="no-guest" type="text" placeholder="Walk-in guest" value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} className={FIELD} />
                    </div>
                    <div>
                      <label htmlFor="no-guest-phone" className={LABEL}>Phone</label>
                      <input id="no-guest-phone" type="tel" inputMode="tel" placeholder="Optional" value={newCustomerPhone} onChange={(e) => setNewCustomerPhone(e.target.value)} className={FIELD} />
                    </div>
                  </div>
                </section>
              )}
            </>
          )}

          {step === 2 && (
            <section className="space-y-3">
              <div className="flex items-end justify-between gap-3">
                <h3 className={`text-[15px] font-bold ${INK}`}>Items &amp; quantities</h3>
                <span className={`text-[13px] ${INK2}`}>
                  {cartItems.length} item{cartItems.length === 1 ? "" : "s"} · {totalQuantity} portion{totalQuantity === 1 ? "" : "s"}
                </span>
              </div>
              {reuseNotice && <p role="status" className="text-[13px] text-[#6B4A06] bg-[#FFF6E5] border border-[#F0CF8E] rounded-xl px-3 py-2">{reuseNotice}</p>}
              <div className="relative">
                <Search className="pointer-events-none w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--rn-ink-3)]" />
                <input
                  type="text"
                  placeholder="Find an item"
                  aria-label="Find an item"
                  value={menuSearch}
                  onChange={(e) => setMenuSearch(e.target.value)}
                  onKeyDown={noEnter}
                  className={`${FIELD} pl-10`}
                />
              </div>
              <ul className="space-y-2" aria-label="Menu">
                {productsQuery.isLoading && products.length === 0 && <li className={`py-6 text-center text-[13.5px] ${INK2}`}>Loading the menu…</li>}
                {!productsQuery.isLoading && filteredProducts.length === 0 && (
                  <li className={`py-6 text-center text-[13.5px] ${INK2}`}>{products.length === 0 ? "No items on the menu." : "No item matches."}</li>
                )}
                {filteredProducts.map((p) => {
                  const qty = cart[p.id]?.quantity || 0;
                  return (
                    <li
                      key={p.id}
                      className={`rounded-[18px] border bg-white p-3 pl-4 flex items-center gap-3 transition-shadow ${
                        qty > 0 ? "border-transparent shadow-[0_0_0_2px_var(--rn-accent)]" : "border-[var(--rn-line)]"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleQuantityChange(p.id, 1)}
                        className="flex-1 min-w-0 text-left py-1"
                        aria-label={`Add ${p.name}`}
                      >
                        <span className={`block text-[15px] font-semibold leading-snug ${INK}`}>{p.name}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-[11.5px] font-semibold px-2 py-0.5 rounded-full bg-[#EFEBE6] text-[#3D3631]">{categoryLabel(p.category)}</span>
                          <span className={`text-[13px] tabular-nums ${INK2}`}>₹{p.price} each</span>
                          {qty > 0 && <span className={`text-[13px] font-bold tabular-nums ${INK}`}>= {rupees(qty * p.price)}</span>}
                        </span>
                      </button>
                      {/* Pill stepper: 44px targets */}
                      <div className="flex items-center shrink-0 rounded-full bg-[var(--rn-accent-tint)] p-1">
                        <button
                          type="button"
                          onClick={() => handleQuantityChange(p.id, -1)}
                          disabled={qty <= 0}
                          aria-label={`One less ${p.name}`}
                          className={`w-11 h-11 rounded-full flex items-center justify-center bg-white ${INK} disabled:opacity-35 disabled:bg-transparent`}
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          value={qty}
                          aria-label={`Quantity of ${p.name}`}
                          onChange={(e) => handleManualQtyInput(p.id, e.target.value)}
                          onFocus={(e) => e.target.select()}
                          onKeyDown={noEnter}
                          className={`w-11 h-11 text-center text-[16px] font-bold tabular-nums bg-transparent border-0 focus:outline-none ${INK} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none`}
                        />
                        <button
                          type="button"
                          onClick={() => handleQuantityChange(p.id, 1)}
                          aria-label={`One more ${p.name}`}
                          className="w-11 h-11 rounded-full flex items-center justify-center bg-[var(--rn-accent)] text-white"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {step === 3 && (
            <>
              <section className="space-y-3">
                <h3 className={`text-[15px] font-bold ${INK}`}>When</h3>
                <div>
                  <label htmlFor="no-date" className={LABEL}>Service date</label>
                  <input id="no-date" type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} className={FIELD} />
                </div>
                <div>
                  <span className={LABEL}>Meal</span>
                  <Segmented label="Meal" value={mealType} onChange={setMealType} options={MEALS.map((m) => ({ v: m.v, label: m.label }))} />
                </div>
                {orderType === "DINE_IN" && (
                  <div>
                    <span className={LABEL}>Paid at the counter by</span>
                    <Segmented
                      label="Payment"
                      value={paymentMethod}
                      onChange={setPaymentMethod}
                      options={[
                        { v: "CASH", label: "Cash" },
                        { v: "UPI", label: "UPI" },
                      ]}
                    />
                  </div>
                )}
                <div>
                  <label htmlFor="no-notes" className={LABEL}>
                    Notes <span className="font-normal">(optional)</span>
                  </label>
                  <input
                    id="no-notes"
                    type="text"
                    placeholder="e.g. Less spicy, leave at the door, ring the bell"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className={FIELD}
                  />
                </div>
              </section>

              <section className="rounded-[18px] border border-[var(--rn-line)] bg-white overflow-hidden" aria-label="Order summary">
                <div className="px-4 py-3.5 flex items-start justify-between gap-3 border-b border-[var(--rn-line)]">
                  <div className="min-w-0">
                    <p className={`text-[12px] font-semibold uppercase tracking-[0.08em] ${INK2}`}>{orderType === "DELIVERY" ? "Delivery to" : "Dine in"}</p>
                    <p className={`text-[15px] font-bold truncate ${INK}`}>{who}</p>
                    {where && <p className={`text-[13px] ${INK2}`}>{where}</p>}
                  </div>
                  <button type="button" onClick={() => goTo(1)} className="h-9 px-3 rounded-full text-[13px] font-semibold text-[var(--rn-accent)] hover:bg-[var(--rn-accent-tint)] shrink-0">
                    Edit
                  </button>
                </div>
                <ul className="px-4 py-2 divide-y divide-[var(--rn-line)]">
                  {cartItems.map((it) => (
                    <li key={it.product.id} className="py-2.5 flex items-center justify-between gap-3 text-[14px]">
                      <span className={`min-w-0 truncate ${INK}`}>
                        <span className="font-bold tabular-nums">{it.quantity}×</span> {it.product.name}
                      </span>
                      <span className={`tabular-nums font-semibold ${INK}`}>{rupees(it.quantity * it.product.price)}</span>
                    </li>
                  ))}
                </ul>
                <div className="px-4 py-3 flex items-center justify-between border-t border-[var(--rn-line)] bg-[var(--rn-accent-tint)]">
                  <button type="button" onClick={() => goTo(2)} className="text-[13px] font-semibold text-[var(--rn-accent)] underline underline-offset-2">
                    Change items
                  </button>
                  <span className={`text-[15px] font-bold tabular-nums ${INK}`}>Total {rupees(totalAmount)}</span>
                </div>
              </section>
              <p className={`text-[13px] ${INK2}`}>
                {orderType === "DELIVERY"
                  ? "The order goes to the delivery staff automatically; payment is taken at the door."
                  : `Recorded as paid at the counter by ${paymentMethod === "UPI" ? "UPI" : "cash"}.`}
              </p>
            </>
          )}
        </div>

        {/* Action bar: always visible */}
        <footer className="shrink-0 px-5 sm:px-6 py-3.5 bg-white border-t border-[var(--rn-line)] shadow-[0_-10px_24px_-18px_rgba(40,20,10,0.35)] pb-[max(0.875rem,env(safe-area-inset-bottom))] flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className={`text-[12.5px] font-medium whitespace-nowrap ${INK2}`}>
              Total · {totalQuantity} portion{totalQuantity === 1 ? "" : "s"}
            </p>
            <p className={`text-[20px] leading-tight font-bold tabular-nums whitespace-nowrap ${INK}`}>{rupees(totalAmount)}</p>
          </div>
          {step === 1 ? (
            <button type="button" onClick={onClose} className={`h-12 px-4 rounded-full text-[14px] font-semibold ${INK2} hover:bg-[var(--rn-accent-tint)]`}>
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={() => goTo((step - 1) as Step)}
              disabled={isSubmitting}
              className={`h-12 pl-3 pr-4 rounded-full text-[14px] font-semibold flex items-center gap-1 ${INK2} hover:bg-[var(--rn-accent-tint)] disabled:opacity-50`}
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
          )}
          <button
            type="submit"
            disabled={isSubmitting || (step === 3 && cartItems.length === 0)}
            className="h-12 px-6 rounded-full bg-[var(--rn-accent)] hover:bg-[var(--rn-accent-strong)] text-white text-[15px] font-bold flex items-center gap-2 shadow-[0_10px_20px_-12px_var(--rn-accent)] disabled:opacity-50"
          >
            {step < 3 ? (
              <>
                Continue
                <ArrowRight className="w-4 h-4" />
              </>
            ) : isSubmitting ? (
              "Confirming…"
            ) : (
              <>
                <Check className="w-4 h-4" />
                Confirm order
              </>
            )}
          </button>
        </footer>
      </form>
    </div>
  );
}
