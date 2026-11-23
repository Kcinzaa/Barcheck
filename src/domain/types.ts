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
}

export interface Item {
  code: string;
  name: string;
  category: string;
  sizeOz?: number;
  form: 'bar' | 'requisition';
  unit?: string;
}
