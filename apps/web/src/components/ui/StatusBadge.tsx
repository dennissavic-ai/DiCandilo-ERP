import clsx from 'clsx';

const statusMap: Record<string, { label: string; className: string }> = {
  // Generic
  DRAFT:              { label: 'Draft',             className: 'badge-gray' },
  ACTIVE:             { label: 'Active',            className: 'badge-green' },
  INACTIVE:           { label: 'Inactive',          className: 'badge-gray' },
  CANCELLED:          { label: 'Cancelled',         className: 'badge-red' },
  // PO
  SUBMITTED:          { label: 'Submitted',         className: 'badge-blue' },
  APPROVED:           { label: 'Approved',          className: 'badge-green' },
  PARTIALLY_RECEIVED: { label: 'Part. Received',    className: 'badge-yellow' },
  RECEIVED:           { label: 'Received',          className: 'badge-green' },
  INVOICED:           { label: 'Invoiced',          className: 'badge-blue' },
  CLOSED:             { label: 'Closed',            className: 'badge-gray' },
  // SO
  CONFIRMED:          { label: 'Confirmed',         className: 'badge-blue' },
  IN_PRODUCTION:      { label: 'In Production',     className: 'badge-orange' },
  READY_TO_SHIP:      { label: 'Ready to Ship',     className: 'badge-yellow' },
  PARTIALLY_SHIPPED:  { label: 'Part. Shipped',     className: 'badge-yellow' },
  SHIPPED:            { label: 'Shipped',           className: 'badge-blue' },
  // Quotes
  SENT:               { label: 'Sent',              className: 'badge-blue' },
  ACCEPTED:           { label: 'Accepted',          className: 'badge-green' },
  DECLINED:           { label: 'Declined',          className: 'badge-red' },
  EXPIRED:            { label: 'Expired',           className: 'badge-gray' },
  CONVERTED:          { label: 'Converted',         className: 'badge-green' },
  // Invoices
  PARTIALLY_PAID:     { label: 'Part. Paid',        className: 'badge-yellow' },
  PAID:               { label: 'Paid',              className: 'badge-green' },
  OVERDUE:            { label: 'Overdue',           className: 'badge-red' },
  WRITTEN_OFF:        { label: 'Written Off',       className: 'badge-red' },
  // Work Orders
  SCHEDULED:          { label: 'Scheduled',         className: 'badge-blue' },
  IN_PROGRESS:        { label: 'In Progress',       className: 'badge-orange' },
  ON_HOLD:            { label: 'On Hold',           className: 'badge-yellow' },
  COMPLETED:          { label: 'Completed',         className: 'badge-green' },
  // Tasks
  OPEN:               { label: 'Open',              className: 'badge-blue' },
  BLOCKED:            { label: 'Blocked',           className: 'badge-red' },
  DONE:               { label: 'Done',              className: 'badge-green' },
};

interface Props {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: Props) {
  const config = statusMap[status] ?? { label: status, className: 'badge-gray' };
  return (
    <span className={clsx(config.className, className)}>
      {config.label}
    </span>
  );
}
