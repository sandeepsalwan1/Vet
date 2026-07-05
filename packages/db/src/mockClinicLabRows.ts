export type MockLabCatalogItem = {
  id: string;
  labVendor: string;
  testCode: string;
  testName: string;
  specimenType: string;
  turnaroundHours: number;
  active: boolean;
  raw: Record<string, unknown>;
};

export type MockLabOrder = {
  id: string;
  labVendor: string;
  externalOrderId: string;
  clientId: string;
  petId: string;
  patientName: string;
  orderedBy: string;
  testCode: string;
  testName: string;
  specimenType: string;
  orderedAt: string;
  status: string;
  raw: Record<string, unknown>;
};

export type MockLabResult = {
  id: string;
  labOrderId: string;
  labVendor: string;
  externalOrderId: string;
  status: string;
  resultSummary: string;
  abnormalFlags: Record<string, unknown>[];
  reportUrl: string | null;
  raw: Record<string, unknown>;
  resultedAt: string | null;
};

export type LabCatalogRow = {
  id: string;
  lab_vendor: string;
  test_code: string;
  test_name: string;
  specimen_type: string;
  turnaround_hours: number;
  active: boolean;
  raw: Record<string, unknown>;
};

export type LabOrderRow = {
  id: string;
  lab_vendor: string;
  external_order_id: string;
  client_id: string;
  pet_id: string;
  patient_name: string;
  ordered_by: string;
  test_code: string;
  test_name: string;
  specimen_type: string;
  ordered_at: string;
  status: string;
  raw: Record<string, unknown>;
};

export type LabResultRow = {
  id: string;
  lab_order_id: string;
  lab_vendor: string;
  external_order_id: string;
  status: string;
  result_summary: string;
  abnormal_flags: Record<string, unknown>[];
  report_url: string | null;
  raw: Record<string, unknown>;
  resulted_at: string | null;
};

export function normalizeLabCatalogItem(row: LabCatalogRow): MockLabCatalogItem {
  return {
    id: row.id,
    labVendor: row.lab_vendor,
    testCode: row.test_code,
    testName: row.test_name,
    specimenType: row.specimen_type,
    turnaroundHours: row.turnaround_hours,
    active: row.active,
    raw: row.raw ?? {}
  };
}

export function normalizeLabOrder(row: LabOrderRow): MockLabOrder {
  return {
    id: row.id,
    labVendor: row.lab_vendor,
    externalOrderId: row.external_order_id,
    clientId: row.client_id,
    petId: row.pet_id,
    patientName: row.patient_name,
    orderedBy: row.ordered_by,
    testCode: row.test_code,
    testName: row.test_name,
    specimenType: row.specimen_type,
    orderedAt: row.ordered_at,
    status: row.status,
    raw: row.raw ?? {}
  };
}

export function normalizeLabResult(row: LabResultRow): MockLabResult {
  return {
    id: row.id,
    labOrderId: row.lab_order_id,
    labVendor: row.lab_vendor,
    externalOrderId: row.external_order_id,
    status: row.status,
    resultSummary: row.result_summary,
    abnormalFlags: row.abnormal_flags ?? [],
    reportUrl: row.report_url,
    raw: row.raw ?? {},
    resultedAt: row.resulted_at
  };
}
