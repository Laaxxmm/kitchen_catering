"use server";

/**
 * Reads. POs, GRNs and bills, as lists and one by id.
 */

import { GRNStatus, VendorBillStatus, VendorPOStatus } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { READ_ROLES } from "./_shared";

// ─── Queries ─────────────────────────────────────────────────────────────

export async function listVendorPOs(opts: { status?: VendorPOStatus[]; vendorId?: string } = {}) {
  await requireRole(READ_ROLES);
  return db.vendorPO.findMany({
    where: {
      ...(opts.status ? { status: { in: opts.status } } : {}),
      ...(opts.vendorId ? { vendorId: opts.vendorId } : {}),
    },
    include: {
      vendor: { select: { name: true, code: true } },
      order: { select: { id: true, code: true } },
      _count: { select: { lines: true } },
    },
    orderBy: { issueDate: "desc" },
    take: 200,
  });
}

export async function getVendorPO(id: string) {
  await requireRole(READ_ROLES);
  return db.vendorPO.findUnique({
    where: { id },
    include: {
      vendor: true,
      order: { select: { id: true, code: true } },
      lines: {
        include: {
          ingredient: { select: { name: true, sku: true, unit: true } },
          // Catalogue unit for banquet-linked lines — the draft line editor
          // hints "catalogue tracks <unit>" when the PO unit differs.
          banquetItem: { select: { name: true, unit: true } },
        },
        orderBy: { sortOrder: "asc" },
      },
      grns: { select: { id: true, grnNo: true, status: true, receivedAt: true } },
      bills: { select: { id: true, billNo: true, status: true, issueDate: true } },
      approvedBy: { select: { name: true } },
      // Two-step approval breadcrumbs — surfaced in the detail-page header.
      managerApprovedBy: { select: { name: true } },
      adminApprovedBy: { select: { name: true } },
    },
  });
}

export async function listGRNs(opts: { status?: GRNStatus[] } = {}) {
  await requireRole(READ_ROLES);
  return db.gRN.findMany({
    where: opts.status ? { status: { in: opts.status } } : {},
    include: {
      po: { include: { vendor: { select: { name: true } } } },
      _count: { select: { lines: true } },
    },
    orderBy: { receivedAt: "desc" },
    take: 200,
  });
}

export async function getGRN(id: string) {
  await requireRole(READ_ROLES);
  return db.gRN.findUnique({
    where: { id },
    include: {
      po: { include: { vendor: true } },
      receivedBy: { select: { name: true } },
      lines: { include: { poLine: { include: { ingredient: { select: { name: true, sku: true, unit: true } } } } }, orderBy: { sortOrder: "asc" } },
    },
  });
}

export async function listVendorBills(opts: { status?: VendorBillStatus[]; vendorId?: string } = {}) {
  await requireRole(READ_ROLES);
  return db.vendorBill.findMany({
    where: {
      ...(opts.status ? { status: { in: opts.status } } : {}),
      ...(opts.vendorId ? { vendorId: opts.vendorId } : {}),
    },
    include: {
      vendor: { select: { id: true, name: true, code: true } },
      po: { select: { poNo: true, order: { select: { code: true } } } },
    },
    orderBy: { issueDate: "desc" },
    take: 200,
  });
}

export async function getVendorBill(id: string) {
  await requireRole(READ_ROLES);
  return db.vendorBill.findUnique({
    where: { id },
    include: {
      vendor: true,
      po: { include: { lines: true, order: { select: { id: true, code: true, customer: { select: { name: true } } } } } },
      matchedBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      lines: { orderBy: { sortOrder: "asc" } },
      payments: { where: { reversedAt: null }, orderBy: { paidAt: "desc" } },
    },
  });
}
