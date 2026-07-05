import { AlertTriangle, ReceiptText } from "lucide-react";

interface InvoiceFlag {
  severity?: string;
  message: string;
}

interface InvoiceLineItem {
  service: string;
  amountCents?: number | string;
  priceCents?: number;
}

export interface InvoiceData {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalCents: number;
  status: string;
  lineItems?: InvoiceLineItem[];
  flags?: InvoiceFlag[];
}

export function InvoiceList({ invoices }: { invoices: InvoiceData[] }) {
  if (!invoices || invoices.length === 0) {
    return <p className="noInvoices">No invoices found for review.</p>;
  }

  return (
    <div className="invoiceList">
      {invoices.map((inv) => (
        <div key={inv.id || inv.invoiceNumber} className="invoiceItem">
          <div className="invoiceItemHeader">
            <div className="invoiceItemNumberGroup">
              <ReceiptText size={14} className="invoiceDocIcon" />
              <span className="invoiceNumber">{inv.invoiceNumber}</span>
            </div>
            <span className="invoiceDate">{inv.invoiceDate}</span>
          </div>
          <div className="invoiceItemBody">
            <div className="invoiceTotalRow">
              <span className="invoiceTotalLabel">Total</span>
              <span className="invoiceTotalAmount">
                ${(inv.totalCents / 100).toFixed(2)}
              </span>
              <span className={`invoiceStatusBadge invoiceStatusBadge--${inv.status}`}>
                {inv.status}
              </span>
            </div>

            {inv.lineItems && inv.lineItems.length > 0 && (
              <div className="invoiceLineItemsSection">
                <div className="invoiceSectionTitle">Line Items</div>
                <div className="invoiceLineItemsList">
                  {inv.lineItems.map((item, idx) => {
                    const amount = typeof item.amountCents === "number"
                      ? item.amountCents
                      : typeof item.amountCents === "string"
                        ? parseInt(item.amountCents, 10)
                        : typeof item.priceCents === "number"
                          ? item.priceCents
                          : 0;
                    return (
                      <div key={idx} className="invoiceLineItemRow">
                        <span className="itemName">{item.service}</span>
                        <span className="itemPrice">${(amount / 100).toFixed(2)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {inv.flags && inv.flags.length > 0 && (
              <div className="invoiceFlagsSection">
                {inv.flags.map((flag, idx) => (
                  <div key={idx} className={`invoiceFlagAlert invoiceFlagAlert--${flag.severity || "medium"}`}>
                    <AlertTriangle size={14} className="flagIcon" />
                    <span className="flagMessage">{flag.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
