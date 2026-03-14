import nodemailer from 'nodemailer';
import { env } from '../config/env';

// ─── Transporter ─────────────────────────────────────────────────────────────

function createTransporter() {
  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) {
    return nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT ?? 587,
      secure: (env.SMTP_PORT ?? 587) === 465,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });
  }
  // No SMTP configured — return null to trigger dev preview logging
  return null;
}

// ─── Send Email ───────────────────────────────────────────────────────────────

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const transporter = createTransporter();
  if (!transporter) {
    // Dev preview: log to console instead of sending
    console.log('[email:preview] ─────────────────────────────────────');
    console.log(`[email:preview]  To:      ${to}`);
    console.log(`[email:preview]  Subject: ${subject}`);
    console.log('[email:preview]  Body (HTML — truncated to 500 chars):');
    console.log(`[email:preview]  ${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 500)}`);
    console.log('[email:preview] ─────────────────────────────────────');
    return;
  }

  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to,
    subject,
    html,
  });
}

// ─── Status Helpers ───────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  CONFIRMED: 'Order Confirmed',
  IN_PRODUCTION: 'In Production',
  READY_TO_SHIP: 'Ready to Ship',
  SHIPPED: 'Shipped',
  INVOICED: 'Invoice Issued',
  CANCELLED: 'Order Cancelled',
  DRAFT: 'Draft',
};

const STATUS_COLORS: Record<string, string> = {
  CONFIRMED: '#16a34a',
  IN_PRODUCTION: '#2563eb',
  READY_TO_SHIP: '#d97706',
  SHIPPED: '#0891b2',
  INVOICED: '#7c3aed',
  CANCELLED: '#dc2626',
  DRAFT: '#6b7280',
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? '#6b7280';
}

function formatCurrency(amountCents: number, currencyCode: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 2,
  }).format(amountCents / 100);
}

// ─── Shared Layout Wrapper ────────────────────────────────────────────────────

function emailLayout(bodyContent: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DiCandilo Metal ERP</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.12);">
          <!-- Header -->
          <tr>
            <td style="background:#2563EB;padding:24px 32px;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">
                DiCandilo Metal ERP
              </h1>
              <p style="margin:4px 0 0;color:#bfdbfe;font-size:13px;">Metal Service Center Management System</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${bodyContent}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px;text-align:center;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">
                &copy; ${new Date().getFullYear()} DiCandilo Metal ERP &mdash; This is an automated message, please do not reply.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Template: Order Status Update ───────────────────────────────────────────

export interface OrderStatusTemplateData {
  orderNumber: string;
  status: string;
  customerName: string;
  totalAmount: number; // raw BigInt value (cents) passed as number
  currencyCode: string;
  lines?: Array<{
    description: string;
    qtyOrdered: string | number;
    unitPrice: number;
    lineTotal: number;
    uom: string;
  }>;
}

export function orderStatusTemplate(order: OrderStatusTemplateData): string {
  const label = statusLabel(order.status);
  const color = statusColor(order.status);
  const total = formatCurrency(Number(order.totalAmount) / 100, order.currencyCode);

  let linesHtml = '';
  if (order.lines && order.lines.length > 0) {
    const rows = order.lines
      .map(
        (l) => `
        <tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:10px 8px;font-size:13px;color:#334155;">${escapeHtml(String(l.description))}</td>
          <td style="padding:10px 8px;font-size:13px;color:#334155;text-align:center;">${escapeHtml(String(l.qtyOrdered))} ${escapeHtml(l.uom)}</td>
          <td style="padding:10px 8px;font-size:13px;color:#334155;text-align:right;">${formatCurrency(Number(l.unitPrice) / 100, order.currencyCode)}</td>
          <td style="padding:10px 8px;font-size:13px;color:#334155;text-align:right;font-weight:600;">${formatCurrency(Number(l.lineTotal) / 100, order.currencyCode)}</td>
        </tr>`
      )
      .join('');

    linesHtml = `
      <h3 style="margin:24px 0 8px;font-size:15px;color:#1e293b;border-bottom:2px solid #e2e8f0;padding-bottom:8px;">Order Lines</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:10px 8px;text-align:left;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Description</th>
            <th style="padding:10px 8px;text-align:center;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Qty</th>
            <th style="padding:10px 8px;text-align:right;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Unit Price</th>
            <th style="padding:10px 8px;text-align:right;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Line Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="3" style="padding:12px 8px;text-align:right;font-size:14px;font-weight:700;color:#1e293b;">Order Total:</td>
            <td style="padding:12px 8px;text-align:right;font-size:14px;font-weight:700;color:#1e293b;">${total}</td>
          </tr>
        </tfoot>
      </table>`;
  }

  const body = `
    <p style="margin:0 0 8px;font-size:15px;color:#475569;">Dear <strong>${escapeHtml(order.customerName)}</strong>,</p>
    <p style="margin:0 0 24px;font-size:15px;color:#475569;">
      We're writing to let you know that your order status has been updated.
    </p>

    <!-- Status Card -->
    <div style="background:#f8fafc;border-left:4px solid ${color};border-radius:4px;padding:20px 24px;margin-bottom:24px;">
      <p style="margin:0 0 6px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Order Number</p>
      <p style="margin:0 0 16px;font-size:24px;font-weight:700;color:#1e293b;">${escapeHtml(order.orderNumber)}</p>
      <p style="margin:0 0 6px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Status</p>
      <span style="display:inline-block;background:${color};color:#ffffff;padding:4px 12px;border-radius:4px;font-size:13px;font-weight:600;">
        ${escapeHtml(label)}
      </span>
      <p style="margin:16px 0 0;font-size:14px;color:#64748b;">
        Order Total: <strong style="color:#1e293b;">${total}</strong>
      </p>
    </div>

    ${linesHtml}

    <p style="margin:24px 0 0;font-size:14px;color:#64748b;">
      If you have any questions, please contact our sales team.
    </p>`;

  return emailLayout(body);
}

// ─── Template: Quote Follow-Up ────────────────────────────────────────────────

export interface QuoteFollowUpTemplateData {
  quoteNumber: string;
  customerName: string;
  validUntil?: string | null;
  totalAmount: number; // cents as number
  daysOld: number;
}

export function quoteFollowUpTemplate(quote: QuoteFollowUpTemplateData): string {
  const total = formatCurrency(Number(quote.totalAmount) / 100, 'USD');
  const validUntilText = quote.validUntil
    ? `<p style="margin:8px 0 0;font-size:14px;color:#64748b;">This quote is valid until <strong>${escapeHtml(quote.validUntil)}</strong>.</p>`
    : '';

  const body = `
    <p style="margin:0 0 8px;font-size:15px;color:#475569;">Dear <strong>${escapeHtml(quote.customerName)}</strong>,</p>
    <p style="margin:0 0 24px;font-size:15px;color:#475569;">
      We noticed that quote <strong>${escapeHtml(quote.quoteNumber)}</strong> is still open. We wanted to follow up and see if you have any questions.
    </p>

    <!-- Quote Card -->
    <div style="background:#f8fafc;border-left:4px solid #2563EB;border-radius:4px;padding:20px 24px;margin-bottom:24px;">
      <p style="margin:0 0 6px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Quote Number</p>
      <p style="margin:0 0 12px;font-size:24px;font-weight:700;color:#1e293b;">${escapeHtml(quote.quoteNumber)}</p>
      <p style="margin:0;font-size:14px;color:#64748b;">
        Quote Value: <strong style="color:#1e293b;">${total}</strong>
      </p>
      <p style="margin:8px 0 0;font-size:14px;color:#64748b;">
        Sent <strong>${Math.round(quote.daysOld)} days ago</strong>
      </p>
      ${validUntilText}
    </div>

    <p style="margin:0 0 8px;font-size:14px;color:#475569;">
      Our team is ready to assist you. If you'd like to discuss the quote, adjust quantities, or move forward with the order, please don't hesitate to reach out.
    </p>
    <p style="margin:24px 0 0;font-size:14px;color:#64748b;">
      We look forward to hearing from you.
    </p>`;

  return emailLayout(body);
}

// ─── Template: Quote Expiry Warning ──────────────────────────────────────────

export interface QuoteExpiryWarningTemplateData {
  quoteNumber: string;
  customerName: string;
  validUntil: string;
  daysUntilExpiry: number;
  totalAmount: number; // cents as number
}

export function quoteExpiryWarningTemplate(quote: QuoteExpiryWarningTemplateData): string {
  const total = formatCurrency(Number(quote.totalAmount) / 100, 'USD');
  const urgencyColor = quote.daysUntilExpiry <= 1 ? '#dc2626' : '#d97706';

  const body = `
    <p style="margin:0 0 8px;font-size:15px;color:#475569;">Dear <strong>${escapeHtml(quote.customerName)}</strong>,</p>
    <p style="margin:0 0 24px;font-size:15px;color:#475569;">
      This is a reminder that your quote is expiring soon.
    </p>

    <!-- Urgency Banner -->
    <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:16px 20px;margin-bottom:24px;text-align:center;">
      <p style="margin:0;font-size:16px;font-weight:700;color:${urgencyColor};">
        &#9888; Quote expires in ${quote.daysUntilExpiry} day${quote.daysUntilExpiry !== 1 ? 's' : ''}
      </p>
      <p style="margin:6px 0 0;font-size:13px;color:#92400e;">Valid until: <strong>${escapeHtml(quote.validUntil)}</strong></p>
    </div>

    <!-- Quote Card -->
    <div style="background:#f8fafc;border-left:4px solid ${urgencyColor};border-radius:4px;padding:20px 24px;margin-bottom:24px;">
      <p style="margin:0 0 6px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Quote Number</p>
      <p style="margin:0 0 12px;font-size:24px;font-weight:700;color:#1e293b;">${escapeHtml(quote.quoteNumber)}</p>
      <p style="margin:0;font-size:14px;color:#64748b;">
        Quote Value: <strong style="color:#1e293b;">${total}</strong>
      </p>
    </div>

    <p style="margin:0 0 8px;font-size:14px;color:#475569;">
      To lock in the pricing and terms, please confirm your order before the quote expires. Contact our sales team to proceed.
    </p>
    <p style="margin:24px 0 0;font-size:14px;color:#64748b;">
      Thank you for choosing DiCandilo Metal ERP.
    </p>`;

  return emailLayout(body);
}

// ─── Template: Prospect Stage Change ─────────────────────────────────────────

export interface ProspectStageTemplateData {
  stage: string;
  contactName: string;
  companyName: string;
}

const STAGE_MESSAGES: Record<string, { heading: string; body: string; color: string }> = {
  CONTACTED: {
    heading: "We've been in touch",
    body:    "Thank you for your interest. One of our team members has reached out and we look forward to learning more about your requirements.",
    color:   '#2563EB',
  },
  QUALIFIED: {
    heading: 'Your enquiry is progressing',
    body:    "We've reviewed your requirements and are pleased to confirm that we can meet your needs. Our team will be in touch shortly to discuss next steps.",
    color:   '#0891b2',
  },
  PROPOSAL: {
    heading: 'Your proposal is ready',
    body:    "We've prepared a proposal tailored to your requirements. Please review the details at your earliest convenience and don't hesitate to reach out with any questions.",
    color:   '#d97706',
  },
  NEGOTIATION: {
    heading: "We're finalising the details",
    body:    "Thank you for your continued interest. We're in the final stages of reviewing terms and will be in touch shortly to confirm the details.",
    color:   '#ea580c',
  },
  WON: {
    heading: 'Welcome aboard!',
    body:    "We're delighted to have your business. Our team will be in touch to confirm the next steps and ensure everything runs smoothly.",
    color:   '#16a34a',
  },
  LOST: {
    heading: 'Thank you for considering us',
    body:    "We appreciate the time you took to explore working with us. Should your requirements change in the future, we'd love the opportunity to work together.",
    color:   '#dc2626',
  },
};

export function prospectStageTemplate(data: ProspectStageTemplateData): string {
  const meta = STAGE_MESSAGES[data.stage.toUpperCase()] ?? {
    heading: `Your deal is now in ${data.stage}`,
    body:    'Your enquiry has been updated. Our team will be in touch with further details.',
    color:   '#6b7280',
  };

  const body = `
    <p style="margin:0 0 8px;font-size:15px;color:#475569;">
      Dear <strong>${escapeHtml(data.contactName)}</strong>,
    </p>
    <p style="margin:0 0 24px;font-size:15px;color:#475569;">
      We have an update regarding your enquiry with <strong>Di Candilo Steel City ERP</strong>.
    </p>

    <div style="background:#f8fafc;border-left:4px solid ${meta.color};border-radius:4px;padding:20px 24px;margin-bottom:24px;">
      <p style="margin:0 0 6px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:600;">
        Status Update
      </p>
      <p style="margin:0 0 12px;font-size:22px;font-weight:700;color:#1e293b;">
        ${escapeHtml(meta.heading)}
      </p>
      <p style="margin:0;font-size:14px;color:#475569;line-height:1.6;">
        ${meta.body}
      </p>
    </div>

    <p style="margin:0;font-size:14px;color:#64748b;">
      If you have any questions or would like to discuss further, please don't hesitate to contact our team.
    </p>`;

  return emailLayout(body);
}

// ─── Template: Invoice Follow-Up ──────────────────────────────────────────

export interface InvoiceFollowUpTemplateData {
  invoiceNumber: string;
  customerName: string;
  dueDate: string;
  daysOverdue: number;
  totalAmount: number; // cents as number
  balanceDue: number;  // cents as number
  currencyCode: string;
}

export function invoiceFollowUpTemplate(data: InvoiceFollowUpTemplateData): string {
  const total = formatCurrency(data.totalAmount, data.currencyCode);
  const balance = formatCurrency(data.balanceDue, data.currencyCode);
  const urgencyColor = data.daysOverdue >= 21 ? '#dc2626' : data.daysOverdue >= 14 ? '#ea580c' : '#d97706';

  const body = `
    <p style="margin:0 0 8px;font-size:15px;color:#475569;">Dear <strong>${escapeHtml(data.customerName)}</strong>,</p>
    <p style="margin:0 0 24px;font-size:15px;color:#475569;">
      This is a friendly reminder that the following invoice is now <strong>${data.daysOverdue} day${data.daysOverdue !== 1 ? 's' : ''} past due</strong>.
    </p>

    <!-- Overdue Banner -->
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:16px 20px;margin-bottom:24px;text-align:center;">
      <p style="margin:0;font-size:16px;font-weight:700;color:${urgencyColor};">
        &#9888; Payment is ${data.daysOverdue} day${data.daysOverdue !== 1 ? 's' : ''} overdue
      </p>
      <p style="margin:6px 0 0;font-size:13px;color:#991b1b;">Due date: <strong>${escapeHtml(data.dueDate)}</strong></p>
    </div>

    <!-- Invoice Card -->
    <div style="background:#f8fafc;border-left:4px solid ${urgencyColor};border-radius:4px;padding:20px 24px;margin-bottom:24px;">
      <p style="margin:0 0 6px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Invoice Number</p>
      <p style="margin:0 0 12px;font-size:24px;font-weight:700;color:#1e293b;">${escapeHtml(data.invoiceNumber)}</p>
      <p style="margin:0;font-size:14px;color:#64748b;">
        Invoice Total: <strong style="color:#1e293b;">${total}</strong>
      </p>
      <p style="margin:8px 0 0;font-size:14px;color:#64748b;">
        Balance Due: <strong style="color:${urgencyColor};">${balance}</strong>
      </p>
    </div>

    <p style="margin:0 0 8px;font-size:14px;color:#475569;">
      If payment has already been made, please disregard this notice. Otherwise, we kindly request that you arrange payment at your earliest convenience.
    </p>
    <p style="margin:24px 0 0;font-size:14px;color:#64748b;">
      If you have any questions about this invoice, please contact our accounts team.
    </p>`;

  return emailLayout(body);
}

// ─── Internal Utility ─────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
