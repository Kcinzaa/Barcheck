export interface BarReportRow {
  itemCode: string;
  openBtl: number;
  openOz: number;
  /** oz */
  dailyStore: number;
  /** oz */
  transferIn: number;
  /** oz */
  transferOut: number;
  /** oz */
  sale: number;
  countedBtl?: number;
  countedOz?: number;
  remark: string;
  /** YYYY-MM-DD of the earlier report Open was auto-filled from; cleared when Open is edited by hand. */
  openFrom?: string;
  /** Item size (oz) when this row was first persisted; calculations prefer it over the item's current size. */
  sizeOz?: number;
}

export interface Item {
  code: string;
  name: string;
  category: string;
  sizeOz?: number;
  form: 'bar' | 'requisition';
  unit?: string;
}
