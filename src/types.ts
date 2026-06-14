export interface Attendee {
  no: number;
  nip: string;
  name: string;
  instansi: string;
  jabatan: string;
  email: string;
  checkInTime: string;
  signatureUrl: string;
  sheetRowIndex?: number;
}

export interface DashboardStats {
  totalCount: number;
  byInstitution: { name: string; value: number }[];
  timeline: { time: string; count: number }[];
}
