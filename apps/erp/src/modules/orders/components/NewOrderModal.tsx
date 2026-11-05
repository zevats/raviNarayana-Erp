"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  X,
  Truck,
  Utensils,
  Search,
  Plus,
  Minus,
  CheckCircle2,
  AlertCircle,
  Clock,
  RotateCcw,
  User,
  Phone,
  MapPin,
  Calendar,
  Sparkles,
} from "lucide-react";
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

export function NewOrderModal({
  isOpen,
  onClose,
  onOrderCreated,
  defaultDate,
}: NewOrderModalProps) {
  // Step 1: Order Type
  const [orderType, setOrderType] = useState<BusinessOrderType>("DELIVERY");

  // Step 2: Customer selection
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

  // Step 3: Menu & Cart
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

  // Each opening starts a clean draft: no customer, phone, address, items or notes carried over
  // from the previous order (order type, meal and date stay as last chosen for fast repeat entry).
  // A failed save does not close the form, so the entered data is kept for a retry.
  useEffect(() => {
    if (!isOpen) return;
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

  // Reuse previous order pattern
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

  // Form submission
  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (cartItems.length === 0) {
      setErrorMessage("Please select at least one menu item.");
      return;
    }

    let customerName = "";
    let customerPhone = "";
    let deliveryAddress = "";
    let customerId: string | undefined = undefined;

    if (orderType === "DELIVERY") {
      if (customerMode === "EXISTING") {
        if (!selectedCustomer) {
          setErrorMessage("Please select an existing delivery customer or switch to 'New Customer'.");
          return;
        }
        customerId = selectedCustomer.id;
        customerName = selectedCustomer.fullName;
        customerPhone = selectedCustomer.phone;
        deliveryAddress = newCustomerAddress.trim() || selectedCustomer.deliveryAddress;
      } else {
        if (duplicateCustomer) {
          setErrorMessage(
            `This phone number already belongs to '${duplicateCustomer.fullName}'. Please click 'Use Existing Customer' or edit the phone number.`
          );
          return;
        }
        if (!newCustomerName.trim() || newCustomerName.trim().length < 2) {
          setErrorMessage("Customer name must be at least 2 characters.");
          return;
        }
        if (!newCustomerPhone.trim() || newCustomerPhone.trim().length < 7) {
          setErrorMessage("Valid customer phone number is required.");
          return;
        }
        if (!newCustomerAddress.trim() || newCustomerAddress.trim().length < 5) {
          setErrorMessage("Valid delivery address is required (minimum 5 characters).");
          return;
        }
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

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-[#FAF8F5] rounded-3xl max-w-2xl w-full border border-[#DCD6CD] shadow-2xl flex flex-col max-h-[92dvh] overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-white border-b border-[#E6E1DA] flex items-center justify-between shrink-0">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#8E9F89] block">
              Fast Order Entry
            </span>
            <h2 className="font-serif text-xl text-[#1A2E20] font-semibold">New Tiffin Order</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-[#8E9F89] hover:text-[#1A2E20] hover:bg-[#FAF8F5] rounded-full transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmitOrder} className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
          {/* Messages */}
          {errorMessage && (
            <div className="p-3.5 bg-red-50 border border-red-200 text-red-800 text-xs rounded-2xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* STEP 1: CHOOSE ORDER TYPE */}
          <div>
            <label className="block text-xs font-serif font-medium text-[#1A2E20] mb-2">
              1. Choose Order Type
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setOrderType("DELIVERY")}
                className={`p-4 rounded-2xl border text-left flex items-center gap-3.5 transition ${
                  orderType === "DELIVERY"
                    ? "bg-[#1A2E20] text-white border-[#1A2E20] shadow-sm"
                    : "bg-white text-[#1A2E20] border-[#E6E1DA] hover:border-[#C89F6B]"
                }`}
              >
                <div
                  className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                    orderType === "DELIVERY" ? "bg-white/10 text-[#C89F6B]" : "bg-[#1A2E20]/5 text-[#1A2E20]"
                  }`}
                >
                  <Truck className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-serif font-bold text-sm leading-tight">Delivery</h4>
                  <p
                    className={`text-[11px] ${
                      orderType === "DELIVERY" ? "text-white/70" : "text-[#8E9F89]"
                    }`}
                  >
                    Doorstep tiffin delivery
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setOrderType("DINE_IN")}
                className={`p-4 rounded-2xl border text-left flex items-center gap-3.5 transition ${
                  orderType === "DINE_IN"
                    ? "bg-[#1A2E20] text-white border-[#1A2E20] shadow-sm"
                    : "bg-white text-[#1A2E20] border-[#E6E1DA] hover:border-[#C89F6B]"
                }`}
              >
                <div
                  className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                    orderType === "DINE_IN" ? "bg-white/10 text-[#C89F6B]" : "bg-[#1A2E20]/5 text-[#1A2E20]"
                  }`}
                >
                  <Utensils className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-serif font-bold text-sm leading-tight">Dine in</h4>
                  <p
                    className={`text-[11px] ${
                      orderType === "DINE_IN" ? "text-white/70" : "text-[#8E9F89]"
                    }`}
                  >
                    Walk-in counter sale
                  </p>
                </div>
              </button>
            </div>
          </div>

          {/* STEP 2: CUSTOMER SELECTION */}
          {orderType === "DELIVERY" ? (
            <div className="bg-white p-4 rounded-2xl border border-[#E6E1DA] space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-serif font-medium text-[#1A2E20]">
                  2. Delivery Customer
                </label>
                <div className="flex bg-[#FAF8F5] p-0.5 rounded-xl border border-[#E6E1DA]">
                  <button
                    type="button"
                    onClick={() => {
                      setCustomerMode("EXISTING");
                      setSelectedCustomer(null);
                    }}
                    className={`px-3 py-1 text-[11px] font-serif rounded-lg transition ${
                      customerMode === "EXISTING"
                        ? "bg-[#1A2E20] text-white shadow-2xs"
                        : "text-[#5D7656] hover:text-[#1A2E20]"
                    }`}
                  >
                    Existing
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomerMode("NEW");
                      setSelectedCustomer(null);
                      setOrderHistory([]);
                    }}
                    className={`px-3 py-1 text-[11px] font-serif rounded-lg transition ${
                      customerMode === "NEW"
                        ? "bg-[#1A2E20] text-white shadow-2xs"
                        : "text-[#5D7656] hover:text-[#1A2E20]"
                    }`}
                  >
                    New Customer
                  </button>
                </div>
              </div>

              {customerMode === "EXISTING" ? (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="pointer-events-none w-4 h-4 absolute left-3 top-2.5 text-[#8E9F89]" />
                    <input
                      type="text"
                      placeholder="Search customer by name or phone..."
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20] focus:outline-hidden focus:border-[#B58A57]"
                    />
                  </div>

                  {/* Customer Quick Selector list */}
                  {!selectedCustomer ? (
                    <div className="max-h-36 overflow-y-auto space-y-1 divide-y divide-[#E6E1DA]/50">
                      {customers.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setSelectedCustomer(c);
                            setNewCustomerAddress(c.deliveryAddress || "");
                          }}
                          className="w-full py-2 px-2 text-left hover:bg-[#FAF8F5] rounded-lg transition flex items-center justify-between text-xs"
                        >
                          <div>
                            <span className="font-serif font-medium text-[#1A2E20]">{c.fullName}</span>
                            <span className="text-[#8E9F89] font-mono text-[11px] ml-2">{c.phone}</span>
                          </div>
                          <span className="text-[11px] text-[#B58A57] font-serif">Select &rarr;</span>
                        </button>
                      ))}
                      {customers.length === 0 && (
                        <p className="text-[11px] text-[#8E9F89] py-2 text-center">
                          No existing customers found. Switch to New Customer.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="p-3 bg-[#FAF8F5] rounded-xl border border-[#C89F6B]/40 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-[#B58A57]" />
                          <span className="font-serif font-bold text-xs text-[#1A2E20]">
                            {selectedCustomer.fullName}
                          </span>
                          <span className="text-xs font-mono text-[#8E9F89]">
                            ({selectedCustomer.phone})
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedCustomer(null)}
                          className="text-[11px] text-red-700 hover:underline"
                        >
                          Change
                        </button>
                      </div>

                      <div>
                        <label className="block text-[10px] font-mono text-[#8E9F89] uppercase mb-0.5">
                          Delivery Address
                        </label>
                        <input
                          type="text"
                          value={newCustomerAddress}
                          onChange={(e) => setNewCustomerAddress(e.target.value)}
                          placeholder="Verify or adjust delivery address..."
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-[#DCD6CD] rounded-lg text-[#1A2E20]"
                        />
                      </div>

                      {/* REPEAT ORDER SHORTCUT */}
                      {isLoadingHistory && (
                        <p className="text-[11px] text-[#8E9F89] italic">Loading past orders...</p>
                      )}
                      {orderHistory.length > 0 && (
                        <div className="pt-2 border-t border-[#E6E1DA] space-y-1.5">
                          <div className="flex items-center gap-1.5 text-[11px] font-serif text-[#1A2E20] font-medium">
                            <RotateCcw className="w-3.5 h-3.5 text-[#C89F6B]" />
                            <span>Quick Repeat: Past Orders</span>
                          </div>
                          <div className="space-y-1">
                            {orderHistory.slice(0, 5).map((past, idx) => (
                              <div
                                key={past.orderId || idx}
                                className="flex items-center justify-between p-2 bg-white rounded-lg border border-[#E6E1DA] text-xs"
                              >
                                <div>
                                  <span className="font-serif text-[#1A2E20] font-medium">
                                    {past.items?.map((it: any) => `${it.quantity}x ${it.productName}`).join(", ")}
                                  </span>
                                  <span className="text-[10px] font-mono text-[#8E9F89] ml-2">
                                    ₹{past.totalAmount} • {past.orderDate}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleReuseOrder(past)}
                                  className="px-2.5 py-1 bg-[#1A2E20]/5 hover:bg-[#1A2E20] text-[#1A2E20] hover:text-white rounded-md text-[11px] font-serif transition shrink-0"
                                >
                                  Reuse
                                </button>
                              </div>
                            ))}
                          </div>
                          <p className="text-[10px] text-[#8E9F89]">Reuse copies the items into this new order at today's prices; change quantities below. Past orders are not changed.</p>
                          {reuseNotice && <p role="status" className="text-[11px] text-amber-800">{reuseNotice}</p>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                /* NEW CUSTOMER INPUTS */
                <div className="space-y-2.5">
                  {/* DUPLICATE CUSTOMER WARNING BANNER */}
                  {duplicateCustomer && (
                    <div className="p-3 bg-amber-50 border border-amber-300 rounded-2xl text-xs space-y-2">
                      <div className="flex items-center gap-2 text-amber-900 font-serif font-bold">
                        <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                        <span>This phone number already exists</span>
                      </div>
                      <div className="p-2.5 bg-white rounded-xl border border-amber-200 text-xs space-y-1">
                        <div className="font-serif font-bold text-[#1A2E20]">
                          {duplicateCustomer.fullName}{" "}
                          <span className="font-mono text-[11px] text-[#8E9F89]">
                            ({duplicateCustomer.phone})
                          </span>
                        </div>
                        {duplicateCustomer.deliveryAddress && (
                          <p className="text-[#5D7656] text-[11px] flex items-start gap-1">
                            <MapPin className="w-3.5 h-3.5 text-[#B58A57] shrink-0 mt-0.5" />
                            <span>{duplicateCustomer.deliveryAddress}</span>
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCustomer(duplicateCustomer);
                            setNewCustomerAddress(duplicateCustomer.deliveryAddress || "");
                            setCustomerMode("EXISTING");
                            setDuplicateCustomer(null);
                          }}
                          className="px-3 py-1.5 bg-[#1A2E20] hover:bg-[#263B2D] text-white text-[11px] font-serif font-medium rounded-xl transition shadow-2xs"
                        >
                          Use Existing Customer
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDuplicateCustomer(null);
                            setNewCustomerPhone("");
                          }}
                          className="px-3 py-1.5 bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 text-[11px] font-serif font-medium rounded-xl transition"
                        >
                          Edit Phone Number
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-serif text-[#1A2E20] mb-1">
                        Customer Name *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Full Name"
                        value={newCustomerName}
                        onChange={(e) => setNewCustomerName(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20] focus:outline-hidden focus:border-[#B58A57]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-serif text-[#1A2E20] mb-1">
                        Phone Number * {isCheckingPhone && <span className="text-[10px] text-[#8E9F89] font-normal italic">(checking...)</span>}
                      </label>
                      <input
                        type="tel"
                        required
                        placeholder="e.g. 9812345678"
                        value={newCustomerPhone}
                        onChange={(e) => setNewCustomerPhone(e.target.value)}
                        className={`w-full px-3 py-2 text-xs bg-[#FAF8F5] border rounded-xl text-[#1A2E20] focus:outline-hidden ${
                          duplicateCustomer ? "border-amber-400 bg-amber-50/20" : "border-[#DCD6CD] focus:border-[#B58A57]"
                        }`}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-serif text-[#1A2E20] mb-1">
                      Delivery Address in City *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Flat, building, landmark, area..."
                      value={newCustomerAddress}
                      onChange={(e) => setNewCustomerAddress(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20] focus:outline-hidden focus:border-[#B58A57]"
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* DINE IN CUSTOMER (OPTIONAL) */
            <div className="bg-white p-3.5 rounded-2xl border border-[#E6E1DA] space-y-2">
              <span className="text-xs font-serif font-medium text-[#1A2E20] block">
                2. Guest Details (Optional)
              </span>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Guest Name (optional)"
                  value={newCustomerName}
                  onChange={(e) => setNewCustomerName(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20]"
                />
                <input
                  type="tel"
                  placeholder="Guest Phone (optional)"
                  value={newCustomerPhone}
                  onChange={(e) => setNewCustomerPhone(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20]"
                />
              </div>
            </div>
          )}

          {/* STEP 3: FAST ITEM & QUANTITY ENTRY */}
          <div className="bg-white p-4 rounded-2xl border border-[#E6E1DA] space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-serif font-medium text-[#1A2E20]">
                3. Menu Items &amp; Quantities
              </label>
              <span className="text-[11px] font-mono text-[#8E9F89]">
                {cartItems.length} selected ({totalQuantity} portions)
              </span>
            </div>

            <div className="relative">
              <Search className="pointer-events-none w-3.5 h-3.5 absolute left-3 top-2.5 text-[#8E9F89]" />
              <input
                type="text"
                placeholder="Filter menu items..."
                value={menuSearch}
                onChange={(e) => setMenuSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20]"
              />
            </div>

            {/* Menu Items Table / Rows */}
            <div className="space-y-1.5 max-h-48 overflow-y-auto divide-y divide-[#E6E1DA]/60">
              {filteredProducts.map((p) => {
                const qty = cart[p.id]?.quantity || 0;
                return (
                  <div
                    key={p.id}
                    className="pt-1.5 pb-1 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-serif font-medium text-[#1A2E20]">{p.name}</span>
                        <span
                          className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-800 border border-emerald-200"
                        >
                          {p.category}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-[#8E9F89]">
                        ₹{p.price} / portion
                      </span>
                    </div>

                    {/* Numeric Stepper Input */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleQuantityChange(p.id, -1)}
                        disabled={qty <= 0}
                        aria-label={`One less ${p.name}`}
                        className="w-9 h-9 rounded-lg bg-[#FAF8F5] hover:bg-[#E6E1DA] disabled:opacity-30 text-[#1A2E20] flex items-center justify-center font-bold text-sm transition"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>

                      <input
                        type="number"
                        min="0"
                        value={qty}
                        aria-label={`Quantity of ${p.name}`}
                        onChange={(e) => handleManualQtyInput(p.id, e.target.value)}
                        className="w-12 h-9 text-center py-1 text-xs font-mono font-bold bg-[#FAF8F5] border border-[#DCD6CD] rounded-lg"
                      />

                      <button
                        type="button"
                        onClick={() => handleQuantityChange(p.id, 1)}
                        aria-label={`One more ${p.name}`}
                        className="w-9 h-9 rounded-lg bg-[#1A2E20] hover:bg-[#263B2D] text-white flex items-center justify-center font-bold text-sm transition"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>

                      <span className="w-16 text-right font-mono text-xs font-bold text-[#1A2E20]">
                        ₹{qty * p.price}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* STEP 4: TIMING, PAYMENT & CONFIRMATION */}
          <div className="bg-white p-4 rounded-2xl border border-[#E6E1DA] space-y-3">
            <div className={`grid gap-3 ${orderType === "DINE_IN" ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2"}`}>
              <div>
                <label className="block text-[11px] font-serif text-[#1A2E20] mb-1">
                  Service Date
                </label>
                <input
                  type="date"
                  value={serviceDate}
                  onChange={(e) => setServiceDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-serif text-[#1A2E20] mb-1">
                  Meal Session
                </label>
                <select
                  value={mealType}
                  onChange={(e) => setMealType(e.target.value as MealType)}
                  className="w-full px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20]"
                >
                  <option value="BREAKFAST">Breakfast</option>
                  <option value="LUNCH">Lunch</option>
                  <option value="DINNER">Dinner</option>
                </select>
              </div>

              {orderType === "DINE_IN" && (
                <div>
                  <label className="block text-[11px] font-serif text-[#1A2E20] mb-1">
                    Payment Method
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as "CASH" | "UPI")}
                    className="w-full px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20]"
                  >
                    <option value="CASH">Cash (Counter)</option>
                    <option value="UPI">UPI / QR Code</option>
                  </select>
                </div>
              )}
            </div>

            <div>
              <label className="block text-[11px] font-serif text-[#1A2E20] mb-1">
                Order Notes <span className="text-[#8E9F89] font-normal">(Optional)</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Less spicy, leave at door, ring bell..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-1.5 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20]"
              />
            </div>
          </div>

          {/* TOTAL & SUBMIT BUTTON */}
          <div className="p-4 bg-[#1A2E20] text-white rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 shadow-sm">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/70">Total Order Value:</span>
                <span className="text-xl font-serif font-bold text-[#C89F6B]">
                  ₹{totalAmount}
                </span>
                <span className="text-xs text-white/60">({totalQuantity} portions)</span>
              </div>
              <p className="text-[11px] text-white/60">
                {orderType === "DELIVERY"
                  ? "Auto-assigned to delivery staff • Doorstep settlement"
                  : `Counter payment recorded via ${paymentMethod}`}
              </p>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 sm:flex-none px-4 py-2.5 text-xs font-serif text-white/80 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || cartItems.length === 0}
                className="flex-1 sm:flex-none px-6 py-2.5 bg-[#C89F6B] hover:bg-[#B58A57] text-[#1A2E20] font-serif font-bold text-xs rounded-xl transition shadow-md disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  "Confirming..."
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    Confirm Order
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
