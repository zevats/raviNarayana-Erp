"use client";

import { planMealsLabel, planCoversMeal } from "@/lib/planMeals";
import { friendlyError } from "@/lib/friendlyError";
import React, { useState, useEffect, useMemo, useRef } from "react";
import { X, Truck, Utensils, Search, Plus, Minus, Check, AlertCircle, RotateCcw, User, MapPin, ChevronLeft, ArrowRight } from "lucide-react";
import { TiffinCustomer, TiffinProduct, MealType, BusinessOrderType, TiffinSubscription } from "@/types";
import { businessToday, businessMeal } from "@/lib/businessDate";
import { useErpQuery } from "@/lib/cache/erpDataCache";

import { PhoneError } from "@/components/forms/PhoneError";
import { AssignToSelect } from "./AssignTo";
interface NewOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after the server confirmed the order, with the message to show; the dialog then closes. */
  onOrderCreated: (message: string) => void;
  /**
   * When given, Confirm closes the form at once and hands the save to the page, which shows the
   * order as "Saving…" and retries with the same key (the server records it once).
   */
  onSubmitInBackground?: (job: PendingOrderJob) => void;
  defaultDate?: string;
  /** Opens with this customer already chosen (e.g. taking an order for a subscriber). */
  presetCustomer?: TiffinCustomer | null;
  /** Subscriptions → Take order: open as a subscription order with this plan chosen. */
  presetPlanId?: string | null;
}

export interface PendingOrderJob {
  key: string;
  customerName: string;
  customerPhone: string | null;
  deliveryAddress: string | null;
  orderType: BusinessOrderType;
  mealType: MealType;
  serviceDate: string;
  total: number;
  itemsText: string;
  items: Array<{ name: string; quantity: number; lineTotal: number }>;
  createdAt: string;
  /** Sends the order; resolves with the confirmation and the saved order id, rejects with a readable error. */
  run: () => Promise<{ message: string; orderId: string | null }>;
}

/** The meal being taken now (lunch until 4 pm India time, dinner after): businessMeal. */
const mealForNow = (): MealType => businessMeal();

// Last order per customer, kept while the page is open: fetched when the pointer rests on a
// customer (or the row is focused), so choosing the customer shows it at once.
const lastOrderCache = new Map<string, { at: number; history: any[] }>();
const lastOrderInflight = new Map<string, Promise<any[]>>();
function loadLastOrder(c: { id: string; phone: string }): Promise<any[]> {
  const hit = lastOrderCache.get(c.id);
  if (hit && Date.now() - hit.at < 120_000) return Promise.resolve(hit.history);
  const running = lastOrderInflight.get(c.id);
  if (running) return running;
  const p = fetch(`/api/orders/history?customerId=${encodeURIComponent(c.id)}&phone=${encodeURIComponent(c.phone)}`)
    .then((res) => (res.ok ? res.json() : { history: [] }))
    .then((data) => {
      const history = Array.isArray(data.history) ? data.history : [];
      lastOrderCache.set(c.id, { at: Date.now(), history });
      return history;
    })
    .catch(() => [] as any[])
    .finally(() => lastOrderInflight.delete(c.id));
  lastOrderInflight.set(c.id, p);
  return p;
}

type Step = 1 | 2 | 3;
const STEPS: Array<{ n: Step; label: string; short: string }> = [
  { n: 1, label: "Customer", short: "Customer" },
  { n: 2, label: "Items", short: "Items" },
  { n: 3, label: "Schedule & confirm", short: "Confirm" },
];
// Orders are taken for breakfast, lunch or dinner.
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
  options: Array<{ v: T; label: React.ReactNode; hint?: string; icon?: React.ElementType }>;
  onChange: (v: T) => void;
  label: string;
  size?: "md" | "lg";
}) {
  // The app's switch: a soft track, the chosen option white; with icons, the icon sits over the
  // name so three choices always fit side by side.
  return (
    <div role="radiogroup" aria-label={label} data-size={size} className="grid gap-1 p-1 rounded-[20px] bg-[#ECE8DF]" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const on = o.v === value;
        const Icon = o.icon;
        return (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.v)}
            className={`min-w-0 rounded-2xl flex flex-col items-center justify-center text-center transition-[background-color,box-shadow,color] duration-200 ${Icon ? "gap-1.5 py-3 px-1.5" : "py-2.5 px-2 min-h-[44px]"} ${
              on ? "bg-white text-[var(--rn-accent)] shadow-[0_1px_2px_rgba(24,33,27,0.08),0_4px_12px_-4px_rgba(24,33,27,0.16)]" : "text-[#4A403A] hover:bg-white/60"
            }`}
          >
            {Icon && <Icon className="w-5 h-5" strokeWidth={1.9} />}
            <span className="block max-w-full truncate text-[13.5px] font-semibold">{o.label}</span>
            {o.hint && <span className="block text-[12px] text-[#6B625B]">{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function NewOrderModal({ isOpen, onClose, onOrderCreated, onSubmitInBackground, defaultDate, presetCustomer, presetPlanId }: NewOrderModalProps) {
  const [step, setStep] = useState<Step>(1);
  // Closing after Confirm: a short fade and drop instead of disappearing at once.
  const [leaving, setLeaving] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Order type
  const [orderType, setOrderType] = useState<BusinessOrderType>("DELIVERY");
  // Subscription order: a delivery for a monthly-plan customer; the plan's thalis for the meal are
  // free (the server checks the plan), extra thalis and other items are charged.
  const [forPlan, setForPlan] = useState(false);
  const [plans, setPlans] = useState<TiffinSubscription[] | null>(null);
  const [plan, setPlan] = useState<TiffinSubscription | null>(null);
  const [planSearch, setPlanSearch] = useState("");

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
  const [mealType, setMealType] = useState<MealType>(mealForNow);
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "UPI" | "PAY_LATER">("CASH");
  const [notes, setNotes] = useState("");

  // State guards
  const [isSubmitting, setIsSubmitting] = useState(false);
  // One idempotency key per order draft: a retry after a lost response or a double click is
  // recognised by the server as the same order. A new key is issued only after a success.
  const [draftKey, setDraftKey] = useState(() => `ord_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
  const [reuseNotice, setReuseNotice] = useState<string | null>(null);
  // After Reuse: what was copied (shown at the top of the items step) and which items to point at.
  const [reused, setReused] = useState<{ ids: string[]; text: string } | null>(null);
  // Delivery: who takes it (the default delivery person unless changed).
  const [assignTo, setAssignTo] = useState("");
  const [flashIds, setFlashIds] = useState<string[]>([]);
  const scrollToReused = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Each opening starts a clean draft at step 1: no customer, phone, address, items or notes carried
  // over from the previous order (order type, meal and date stay as last chosen for fast repeat entry).
  // A failed save does not close the form, so the entered data is kept for a retry.
  useEffect(() => {
    if (!isOpen) return;
    setStep(1);
    setMealType(mealForNow());
    setForPlan(false);
    setPlan(null);
    setPlanSearch("");
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
    setAssignTo("");
    setErrorMessage(null);
    setReuseNotice(null);
    setReused(null);
    setFlashIds([]);
    if (presetCustomer) {
      setOrderType("DELIVERY");
      setCustomerMode("EXISTING");
      setSelectedCustomer(presetCustomer);
      setNewCustomerAddress(presetCustomer.deliveryAddress || "");
    }
    if (presetPlanId) {
      setForPlan(true);
      setOrderType("DELIVERY");
      setCustomerMode("EXISTING");
      fetch(`/api/tiffin/subscriptions/${encodeURIComponent(presetPlanId)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const s: TiffinSubscription | undefined = d?.subscription;
          if (!s) return;
          setPlan(s);
          setSelectedCustomer({ id: s.customerId, fullName: s.customerName || "", phone: s.customerPhone || "", deliveryAddress: s.deliveryAddress, status: "ACTIVE" } as TiffinCustomer);
          setNewCustomerAddress(s.deliveryAddress || "");
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Active plans, searched on the server by name or phone (the list is capped at 200 a request).
  useEffect(() => {
    if (!isOpen || !forPlan || plan) return;
    const q = planSearch.trim();
    let gone = false;
    const t = window.setTimeout(() => {
      fetch(`/api/tiffin/subscriptions?status=ACTIVE&limit=200${q ? `&search=${encodeURIComponent(q)}` : ""}`)
        .then((r) => (r.ok ? r.json() : { subscriptions: [] }))
        .then((d) => !gone && setPlans(Array.isArray(d.subscriptions) ? d.subscriptions : []))
        .catch(() => !gone && setPlans([]));
    }, q ? 220 : 0);
    return () => {
      gone = true;
      window.clearTimeout(t);
    };
  }, [isOpen, forPlan, plan, planSearch]);

  // Escape closes the form (unless an order is being saved).
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSubmitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, isSubmitting, onClose]);

  // A new step starts at its top; after Reuse the items step scrolls to the first copied item.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    if (step === 2 && scrollToReused.current && reused?.ids.length) {
      scrollToReused.current = false;
      requestAnimationFrame(() => {
        const el = body.querySelector<HTMLElement>(`[data-pid="${reused.ids[0]}"]`);
        if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
        else body.scrollTo({ top: 0 });
      });
      return;
    }
    body.scrollTo({ top: 0 });
  }, [step, reused]);

  // The copied items are highlighted for a moment so the eye finds them.
  useEffect(() => {
    if (flashIds.length === 0) return;
    const t = setTimeout(() => setFlashIds([]), 2600);
    return () => clearTimeout(t);
  }, [flashIds]);

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
  // Every active customer, by name, in one light request (no balances): the list shows them all at
  // once and the search filters it on the phone, with no wait.
  const customersQuery = useErpQuery<TiffinCustomer[]>(
    "/api/tiffin/customers?status=ACTIVE&picker=1&limit=2000",
    async () => {
      const res = await fetch("/api/tiffin/customers?status=ACTIVE&picker=1&limit=2000");
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

  // A customer added a moment ago may not be in the cached list yet: the search also asks the
  // server and adds what it finds (the list stays instant; this only fills gaps).
  useEffect(() => {
    if (!isOpen || customerMode !== "EXISTING" || customerSearch.trim().length < 2) return;
    let gone = false;
    const t = setTimeout(() => {
      fetch(`/api/tiffin/customers?status=ACTIVE&picker=1&limit=30&search=${encodeURIComponent(customerSearch.trim())}`)
        .then((res) => (res.ok ? res.json() : { customers: [] }))
        .then((data) => {
          if (gone || !Array.isArray(data.customers) || data.customers.length === 0) return;
          setCustomers((list) => {
            const have = new Set(list.map((c) => c.id));
            const extra = (data.customers as TiffinCustomer[]).filter((c) => !have.has(c.id));
            return extra.length ? [...extra, ...list] : list;
          });
        })
        .catch(() => {});
    }, 200);
    return () => {
      gone = true;
      clearTimeout(t);
    };
  }, [customerSearch, customerMode, isOpen]);

  const shownCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return customers.filter((c) => !q || [c.fullName, c.customerCode, c.deliveryAddress, c.landmark].some((v) => String(v || "").toLowerCase().includes(q)) || (digits.length >= 2 && [c.phone, c.alternatePhone].some((v) => String(v || "").replace(/\D/g, "").includes(digits))));
  }, [customers, customerSearch]);

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
    const cached = lastOrderCache.get(selectedCustomer.id);
    if (cached) setOrderHistory(cached.history);
    let live = true;
    setIsLoadingHistory(!cached);
    loadLastOrder(selectedCustomer)
      .then((history) => {
        if (live) setOrderHistory(history);
      })
      .finally(() => {
        if (live) setIsLoadingHistory(false);
      });
    return () => {
      live = false;
    };
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
    const ids = Object.keys(newCart);
    const when = (() => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(pastOrder.orderDate || ""));
      if (!m) return "the last order";
      const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
      return `the order of ${dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}`;
    })();
    const list = Object.values(newCart).map((c) => `${c.quantity}× ${c.product.name}`).join(", ");
    setReused(ids.length ? { ids, text: `Copied from ${when}: ${list}. Change the quantities below if needed.` } : null);
    setFlashIds(ids);
    setMenuSearch("");
    scrollToReused.current = ids.length > 0;
    if (pastOrder.mealType) setMealType(pastOrder.mealType);
    if (pastOrder.deliveryAddress && selectedCustomer) {
      setNewCustomerAddress(pastOrder.deliveryAddress);
    }
    // The items are filled in: go straight to them to check the quantities.
    setErrorMessage(null);
    setStep(2);
  };

  // Quantity controllers
  // A plan meal is the plan's thalis, never priced one by one: the meal thali count stops at the plan's.
  const capPlan = (prev: typeof cart, next: typeof cart, productId: string): typeof cart => {
    const item = next[productId];
    if (!item || !planCovers || item.product.category !== "STANDARD_MEAL") return next;
    const others = Object.values(next).filter((it) => it.product.id !== productId && it.product.category === "STANDARD_MEAL").reduce((n, it) => n + it.quantity, 0);
    const allowed = Math.max(0, planFreeThalis - others);
    if (item.quantity <= allowed) return next;
    if (allowed === 0) return prev;
    return { ...next, [productId]: { ...item, quantity: allowed } };
  };
  const handleQuantityChange = (productId: string, delta: number) => {
    setCart((prev) => capPlan(prev, ((): typeof cart => {
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
    })(), productId));
  };

  const handleManualQtyInput = (productId: string, val: string) => {
    const num = parseInt(val, 10);
    setCart((prev) => capPlan(prev, ((): typeof cart => {
      const prod = prev[productId]?.product || products.find((p) => p.id === productId);
      if (!prod) return prev;
      if (isNaN(num) || num <= 0) {
        const copy = { ...prev };
        delete copy[productId];
        return copy;
      }
      return { ...prev, [productId]: { product: prod, quantity: num } };
    })(), productId));
  };

  // Cart summary calculations
  const cartItems = useMemo(() => Object.values(cart), [cart]);
  const totalQuantity = useMemo(() => cartItems.reduce((s, it) => s + it.quantity, 0), [cartItems]);
  const planCovers = Boolean(forPlan && plan && planCoversMeal(plan.mealTypes, mealType));
  const planFreeThalis = planCovers && plan ? plan.quantityPerMeal : 0;
  const planFreeValue = useMemo(() => {
    let left = planFreeThalis;
    let value = 0;
    for (const it of cartItems) {
      if (left <= 0) break;
      if (it.product.category !== "STANDARD_MEAL") continue;
      const free = Math.min(left, it.quantity);
      left -= free;
      value += free * it.product.price;
    }
    return value;
  }, [cartItems, planFreeThalis]);
  const totalAmount = useMemo(() => cartItems.reduce((s, it) => s + it.quantity * it.product.price, 0) - planFreeValue, [cartItems, planFreeValue]);
  // A plan customer whose plan covers the whole order pays nothing (no payment choice at the counter).
  const nothingToPay = Boolean(forPlan && plan && totalAmount <= 0 && cartItems.length > 0);

  const filteredProducts = useMemo(() => {
    if (!menuSearch.trim()) return products;
    const q = menuSearch.toLowerCase().trim();
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
  }, [products, menuSearch]);

  /** What is wrong with the customer step, or null when it is complete. */
  const customerProblem = (): string | null => {
    // A plan customer (delivery or dine in): the plan holds the name, phone and address.
    if (forPlan) return plan ? null : "Choose the subscription customer.";
    if (orderType !== "DELIVERY") {
      // Pay Later at the counter: the guest must be identifiable to be asked for the money later.
      if (paymentMethod !== "PAY_LATER") return null;
      if (newCustomerName.trim().length < 2) return "For Pay Later, enter the guest name.";
      if (newCustomerPhone.replace(/\D/g, "").length < 7) return "For Pay Later, enter the guest phone number.";
      return null;
    }
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
    if (target === 2 && forPlan && plan && cartItems.length === 0) {
      const thali = products.find((p) => p.category === "STANDARD_MEAL" && p.status === "ACTIVE");
      if (thali) setCart({ [thali.id]: { product: thali, quantity: Math.max(1, plan.quantityPerMeal) } });
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
    } else if (forPlan && selectedCustomer) {
      customerId = selectedCustomer.id;
      customerName = selectedCustomer.fullName;
      customerPhone = selectedCustomer.phone;
    } else {
      customerName = newCustomerName.trim() || "Walk-in Guest";
      customerPhone = newCustomerPhone.trim() || "";
    }

    const itemsPayload = cartItems.map((it) => ({
      productId: it.product.id,
      productName: it.product.name,
      quantity: it.quantity,
      unitPrice: it.product.price,
    }));
    const key = draftKey;
    const body = JSON.stringify({
      orderType,
      customerId,
      customerName,
      customerPhone,
      deliveryAddress: orderType === "DELIVERY" ? deliveryAddress : undefined,
      serviceDate,
      mealType,
      items: itemsPayload,
      paymentMethod: orderType === "DINE_IN" && !nothingToPay ? paymentMethod : undefined,
      payLater: orderType === "DINE_IN" && !nothingToPay && paymentMethod === "PAY_LATER" ? true : undefined,
      paymentStatus: orderType === "DINE_IN" && (nothingToPay || paymentMethod !== "PAY_LATER") ? "PAID" : "PENDING",
      notes: notes.trim() || undefined,
      subscriptionId: forPlan && plan ? plan.id : undefined,
      assignToStaffId: orderType === "DELIVERY" && assignTo ? assignTo : undefined,
      idempotencyKey: key,
    });
    const amount = totalAmount;
    const method = paymentMethod;
    const type = orderType;
    // Sending is safe to repeat: the key makes the server record the order once.
    const run = async (): Promise<{ message: string; orderId: string | null }> => {
      let res: Response;
      try {
        res = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body });
      } catch {
        throw new Error("No connection. The order was not sent yet; try again.");
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to confirm order.");
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("erp:order_created"));
      if (customerId) lastOrderCache.delete(customerId);
      const message =
        type === "DELIVERY"
          ? data.order?.assignedToName
            ? `Order confirmed and sent to ${data.order.assignedToName}.`
            : "Delivery order confirmed, but no active delivery staff account exists. Create or reactivate one in Staff Administration."
          : method === "PAY_LATER"
            ? `Dine-in order saved on Pay Later: ₹${amount} is on ${customerName}'s account.`
            : `Dine-in order confirmed (₹${amount} by ${method === "UPI" ? "UPI" : "cash"}).`;
      return { message, orderId: data.order?.orderId ?? data.orderId ?? null };
    };

    if (onSubmitInBackground) {
      // Instant: the form closes now; the page shows the order as saving and confirms it.
      onSubmitInBackground({
        key,
        customerName: customerName || "Walk-in guest",
        customerPhone: customerPhone || null,
        deliveryAddress: orderType === "DELIVERY" ? deliveryAddress : null,
        orderType,
        mealType,
        serviceDate,
        total: amount,
        itemsText: cartItems.map((it) => `${it.quantity}× ${it.product.name}`).join(", "),
        items: cartItems.map((it) => ({ name: it.product.name, quantity: it.quantity, lineTotal: it.quantity * it.product.price })),
        createdAt: new Date().toISOString(),
        run,
      });
      setDraftKey(`ord_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
      // The form eases out (the order is already on the list, saving).
      setLeaving(true);
      window.setTimeout(() => {
        setLeaving(false);
        onClose();
      }, 160);
      return;
    }

    setIsSubmitting(true);
    try {
      const { message: confirmed } = await run();
      // Close as soon as the server confirmed; the page shows the confirmation. (A delayed close
      // left the button active with a new draft key, so a second click created a second order.)
      setDraftKey(`ord_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
      onOrderCreated(confirmed);
      onClose();
    } catch (err: any) {
      setErrorMessage(friendlyError(err.message || "Failed to submit order. Please check entered information."));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const who =
    forPlan && selectedCustomer
      ? selectedCustomer.fullName
      : orderType === "DINE_IN"
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
      className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-[rgba(24,16,10,0.42)] backdrop-blur-[6px] transition-opacity duration-150 ${leaving ? "opacity-0" : "opacity-100"} rn-modal-scrim rn-order-scrim`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <form
        onSubmit={handleSubmitOrder}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-order-title"
        className={`rn-modal w-full sm:max-w-[640px] h-[94dvh] sm:h-auto sm:max-h-[min(860px,92dvh)] flex flex-col overflow-hidden rounded-t-[26px] sm:rounded-[26px] border border-[var(--rn-line)] shadow-[0_30px_80px_-30px_rgba(40,20,10,0.55)] transition-[transform,opacity] duration-150 ease-out ${leaving ? "translate-y-3 scale-[0.98] opacity-0" : ""} rn-order-sheet rn-own`}
        style={{ backgroundColor: "#F7F5F0", ["--rn-accent" as string]: "#C9501C", ["--rn-accent-strong" as string]: "#A9400F", ["--rn-accent-tint" as string]: "#FCE9DD", ["--rn-accent-soft" as string]: "#FCE9DD" } as React.CSSProperties}
      >
        {/* Header: title and the three steps */}
        <header className="shrink-0 px-5 sm:px-6 pt-5 pb-4 bg-white border-b border-[var(--rn-line)]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
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
        <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-6 py-5 space-y-5">
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
                  value={forPlan ? ("SUBSCRIPTION" as const) : orderType}
                  onChange={(v) => {
                    setErrorMessage(null);
                    if (v === "SUBSCRIPTION") {
                      setForPlan(true);
                      setOrderType("DELIVERY");
                      setCustomerMode("EXISTING");
                      setSelectedCustomer(null);
                    } else {
                      setForPlan(false);
                      setPlan(null);
                      setOrderType(v);
                    }
                  }}
                  options={[
                    { v: "DELIVERY", label: "Delivery", icon: Truck },
                    { v: "DINE_IN", label: "Dine in", icon: Utensils },
                    { v: "SUBSCRIPTION" as BusinessOrderType, label: "Subscription", icon: RotateCcw },
                  ]}
                />
              </section>

              {forPlan ? (
                <section className="space-y-3">
                  <h3 className={`text-[15px] font-bold ${INK}`}>Subscription customer</h3>
                  {plan ? (
                    <div className="rounded-[18px] border border-[var(--rn-line)] bg-white p-4 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className={`text-[15px] font-bold truncate ${INK}`}>{plan.customerName}</p>
                          <p className={`text-[13px] ${INK2}`}>{plan.customerPhone}</p>
                        </div>
                        <button type="button" onClick={() => { setPlan(null); setSelectedCustomer(null); }} className="h-10 px-3.5 rounded-full text-[13px] font-semibold text-[var(--rn-accent)] hover:bg-[var(--rn-accent-tint)]">
                          Change
                        </button>
                      </div>
                      <p className={`text-[13.5px] ${INK}`}>
                        <strong>{plan.productName}</strong> · {planMealsLabel(plan.mealTypes)} · {plan.quantityPerMeal} thali{plan.quantityPerMeal === 1 ? "" : "s"} a meal
                      </p>
                      <p className={`text-[13px] ${INK2}`}>{plan.deliveryAddress}</p>
                      <div className="pt-1">
                        <span className={LABEL}>How is the meal taken?</span>
                        <Segmented
                          label="Delivery or dine in"
                          value={orderType}
                          onChange={(v) => {
                            setOrderType(v);
                            setErrorMessage(null);
                          }}
                          options={[
                            { v: "DELIVERY", label: "Delivery", icon: Truck },
                            { v: "DINE_IN", label: "Dine in", icon: Utensils },
                          ]}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="relative">
                        <Search className="pointer-events-none w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--rn-ink-3)]" />
                        <input type="text" placeholder="Search by name or phone" aria-label="Search subscription customers" value={planSearch} onChange={(e) => setPlanSearch(e.target.value)} onKeyDown={noEnter} className={`${FIELD} pl-10`} />
                      </div>
                      <ul className="rounded-[18px] border border-[var(--rn-line)] bg-white divide-y divide-[var(--rn-line)] overflow-hidden" aria-label="Subscription customers">
                        {plans === null && <li className={`px-4 py-5 text-center text-[13.5px] ${INK2}`}>Loading plans…</li>}
                        {(plans ?? [])
                          .filter((s) => {
                            const q = planSearch.trim().toLowerCase();
                            return !q || (s.customerName || "").toLowerCase().includes(q) || (s.customerPhone || "").includes(q);
                          })
                          .slice(0, 40)
                          .map((s) => (
                            <li key={s.id}>
                              <button
                                type="button"
                                onClick={() => {
                                  setPlan(s);
                                  setSelectedCustomer({ id: s.customerId, fullName: s.customerName || "", phone: s.customerPhone || "", deliveryAddress: s.deliveryAddress, status: "ACTIVE" } as TiffinCustomer);
                                  setNewCustomerAddress(s.deliveryAddress || "");
                                  setErrorMessage(null);
                                }}
                                className="w-full min-h-[56px] px-4 py-2.5 text-left flex items-center justify-between gap-3 hover:bg-[var(--rn-accent-tint)] transition-colors"
                              >
                                <span className="min-w-0">
                                  <span className={`block text-[14.5px] font-semibold truncate ${INK}`}>{s.customerName}</span>
                                  <span className={`block text-[13px] truncate ${INK2}`}>{s.customerPhone} · {s.productName}</span>
                                </span>
                                <ArrowRight className="w-4 h-4 shrink-0 text-[var(--rn-ink-3)]" />
                              </button>
                            </li>
                          ))}
                        {plans !== null && plans.length === 0 && <li className={`px-4 py-5 text-center text-[13.5px] ${INK2}`}>{planSearch.trim() ? "No subscription customer matches." : "No active subscriptions."}</li>}
                      </ul>
                    </div>
                  )}
                </section>
              ) : orderType === "DELIVERY" ? (
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
                            placeholder="Search name, phone or address"
                            aria-label="Search customers"
                            value={customerSearch}
                            onChange={(e) => setCustomerSearch(e.target.value)}
                            onKeyDown={noEnter}
                            className={`${FIELD} pl-10`}
                          />
                        </div>
                        <ul className="rn-pick-list rounded-[18px] border border-[var(--rn-line)] bg-white divide-y divide-[var(--rn-line)]" aria-label="Customers">
                          {customersQuery.isLoading && customers.length === 0 &&
                            Array.from({ length: 4 }).map((_, i) => (
                              <li key={i} className="px-4 py-3"><span className="rn-skel block h-9 w-full rounded-xl" /></li>
                            ))}
                          {shownCustomers.map((c) => (
                            <li key={c.id}>
                              <button
                                type="button"
                                onPointerEnter={() => void loadLastOrder(c)}
                                onPointerDown={() => void loadLastOrder(c)}
                                onFocus={() => void loadLastOrder(c)}
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
                          {!customersQuery.isLoading && shownCustomers.length === 0 && (
                            <li className={`px-4 py-5 text-center text-[13.5px] ${INK2}`}>{customers.length === 0 ? "No customers yet" : "No customer found"}</li>
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
                          <PhoneError value={newCustomerPhone} />
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
                    Guest <span className={`font-normal text-[13.5px] ${INK2}`}>(needed for Pay Later)</span>
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="no-guest" className={LABEL}>Name</label>
                      <input id="no-guest" type="text" placeholder="Walk-in guest" value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} className={FIELD} />
                    </div>
                    <div>
                      <label htmlFor="no-guest-phone" className={LABEL}>Phone</label>
                      <input id="no-guest-phone" type="tel" inputMode="tel" placeholder="Optional" value={newCustomerPhone} onChange={(e) => setNewCustomerPhone(e.target.value)} className={FIELD} />
                      <PhoneError value={newCustomerPhone} required={false} />
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
              {reused && (
                // Stays at the top while the list scrolls, so the confirmation is seen next to the items.
                <div role="status" aria-live="polite" className="sticky -top-5 z-10 -mx-1 px-1 pt-1 pb-1 bg-[#FBF8F4]">
                  <div className="flex items-start gap-2.5 rounded-xl border border-[#A3D396] bg-[#E6F4E1] px-3.5 py-2.5 text-[13.5px] text-[#1D4E16]">
                    <Check className="w-4 h-4 mt-0.5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <strong className="font-bold">Order reused.</strong> {reused.text}
                    </span>
                    <button type="button" onClick={() => setReused(null)} aria-label="Dismiss" className="-my-1 -mr-1.5 w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/60 shrink-0">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
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
                  const inPlan = planCovers && p.category === "STANDARD_MEAL";
                  const planFull = inPlan && cartItems.filter((it) => it.product.category === "STANDARD_MEAL").reduce((n, it) => n + it.quantity, 0) >= planFreeThalis;
                  return (
                    <li
                      key={p.id}
                      data-pid={p.id}
                      className={`rounded-[18px] border p-3 pl-4 flex items-center gap-3 transition-[box-shadow,background-color] duration-700 scroll-mt-16 ${
                        flashIds.includes(p.id) ? "bg-[#FFF1DF]" : "bg-white"
                      } ${qty > 0 ? "border-transparent shadow-[0_0_0_2px_var(--rn-accent)]" : "border-[var(--rn-line)]"}`}
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
                          {inPlan ? (
                            <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full bg-[#E6F4E1] text-[#1D4E16]">In plan</span>
                          ) : (
                            <>
                              <span className={`text-[13px] tabular-nums ${INK2}`}>₹{p.price} each</span>
                              {qty > 0 && <span className={`text-[13px] font-bold tabular-nums ${INK}`}>= {rupees(qty * p.price)}</span>}
                            </>
                          )}
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
                          disabled={planFull}
                          aria-label={`One more ${p.name}`}
                          className="w-11 h-11 rounded-full flex items-center justify-center bg-[var(--rn-accent)] text-white disabled:opacity-35"
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
                {orderType === "DELIVERY" && (
                  <div>
                    <span className={LABEL}>Assign to</span>
                    <AssignToSelect value={assignTo} onChange={setAssignTo} className={FIELD} />
                  </div>
                )}
                {orderType === "DINE_IN" && nothingToPay && (
                  <p className="rounded-xl px-3.5 py-2.5 text-[13.5px] bg-[#E6F4E1] text-[#1D4E16]">Nothing to pay: the plan covers this meal.</p>
                )}
                {orderType === "DINE_IN" && !nothingToPay && (
                  <div>
                    <span className={LABEL}>Payment</span>
                    <Segmented
                      label="Payment"
                      value={paymentMethod}
                      onChange={(v) => {
                        setPaymentMethod(v);
                        setErrorMessage(null);
                      }}
                      options={[
                        { v: "CASH", label: "Cash" },
                        { v: "UPI", label: "UPI" },
                        { v: "PAY_LATER", label: "Pay later" },
                      ]}
                    />
                    {paymentMethod === "PAY_LATER" && (
                      <p className={`mt-2 text-[13px] ${INK2}`}>
                        Nothing is collected now: {rupees(totalAmount)} goes on {(forPlan ? selectedCustomer?.fullName : newCustomerName.trim()) || "the guest"}&apos;s account (Finance → Receivables).
                        {!forPlan && (newCustomerName.trim().length < 2 || newCustomerPhone.replace(/\D/g, "").length < 7) && (
                          <button type="button" onClick={() => goTo(1)} className="ml-1 font-semibold text-[var(--rn-accent)] underline underline-offset-2">
                            Add the guest name and phone
                          </button>
                        )}
                      </p>
                    )}
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
                  : paymentMethod === "PAY_LATER"
                    ? "Not paid now: the amount stays on the guest's account until it is paid."
                    : `Recorded as paid at the counter by ${paymentMethod === "UPI" ? "UPI" : "cash"}.`}
              </p>
            </>
          )}
        </div>

        {/* Action bar: always visible */}
        <footer className="shrink-0 px-5 sm:px-6 pt-3 sm:py-3.5 bg-white border-t border-[var(--rn-line)] shadow-[0_-10px_24px_-18px_rgba(40,20,10,0.35)] pb-[max(0.875rem,env(safe-area-inset-bottom))] flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="min-w-0 sm:flex-1 flex items-baseline justify-between sm:block">
            <p className={`text-[13px] font-medium whitespace-nowrap ${INK2}`}>
              Total · {totalQuantity} portion{totalQuantity === 1 ? "" : "s"}
            </p>
            <p className={`text-[20px] leading-tight font-semibold tabular-nums whitespace-nowrap ${INK}`}>{rupees(totalAmount)}</p>
          </div>
          <div className={`grid gap-2.5 sm:flex sm:items-center ${step > 1 ? "grid-cols-[1fr_2fr]" : "grid-cols-1"}`}>
            {step > 1 && (
              <button
                type="button"
                onClick={() => goTo((step - 1) as Step)}
                disabled={isSubmitting}
                className={`h-12 px-4 rounded-full bg-[#EEEAE2] sm:bg-transparent text-[14.5px] font-semibold flex items-center justify-center gap-1 ${INK2} hover:bg-[var(--rn-accent-tint)] disabled:opacity-50`}
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>
            )}
            <button
              type="submit"
              disabled={isSubmitting || (step === 3 && cartItems.length === 0)}
              className="h-12 px-6 rounded-full bg-[var(--rn-accent)] hover:bg-[var(--rn-accent-strong)] text-white text-[15px] font-semibold flex items-center justify-center gap-2 shadow-[0_10px_20px_-12px_var(--rn-accent)] disabled:opacity-50"
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
          </div>
        </footer>
      </form>
    </div>
  );
}
