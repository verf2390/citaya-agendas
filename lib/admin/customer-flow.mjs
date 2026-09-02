import { safeInternalRedirect } from "../security/redirects.mjs";

export function resolveCustomerUpsertFlow(searchParams, customers) {
  const returnTo = safeInternalRedirect(searchParams.get("returnTo"), "");
  const editId = searchParams.get("edit") ?? "";
  const editing = editId
    ? customers.find((customer) => customer.id === editId) ?? null
    : null;
  const createRequested = searchParams.get("new") === "1";

  return {
    returnTo,
    editing,
    shouldOpen: editId ? Boolean(editing) : createRequested,
  };
}

export function buildCustomerReturnPath(returnTo, customerId) {
  const safeReturnTo = safeInternalRedirect(returnTo, "");
  if (!safeReturnTo || typeof customerId !== "string" || !customerId) return "";

  const parsed = new URL(safeReturnTo, "https://citaya.invalid");
  parsed.searchParams.set("customerId", customerId);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
