// Temporary UI-only data. These values are not loaded from Supabase.
export type MetricTone = "positive" | "warning" | "neutral" | "danger";

export const dashboardMetrics = [
  { label: "Total customers", value: "1,248", delta: "+14%", tone: "positive" },
  { label: "Repair requests", value: "486", delta: "+9%", tone: "neutral" },
  { label: "Active repair jobs", value: "72", delta: "+5%", tone: "warning" },
  { label: "Waiting for approval", value: "18", delta: "-2%", tone: "warning" },
  { label: "Waiting for parts", value: "11", delta: "+3%", tone: "neutral" },
  { label: "Awaiting QC", value: "9", delta: "+1%", tone: "primary" },
  { label: "Completed jobs", value: "318", delta: "+12%", tone: "positive" },
  { label: "Follow-ups due", value: "27", delta: "-4%", tone: "danger" },
] as const;

export const repairQueue = [
  {
    id: "RF-2048",
    customer: "Nadia Green",
    device: "Samsung Galaxy S23",
    issue: "Charging port repair",
    status: "Awaiting approval",
    technician: "Samuel",
    priority: "High",
  },
  {
    id: "RF-2034",
    customer: "Michael Chen",
    device: "LG Front Load Washer",
    issue: "Drain pump diagnosis",
    status: "In progress",
    technician: "Alicia",
    priority: "Medium",
  },
  {
    id: "RF-2021",
    customer: "Rosalind Price",
    device: "Dell XPS 13",
    issue: "Motherboard inspection",
    status: "Waiting for parts",
    technician: "David",
    priority: "Urgent",
  },
  {
    id: "RF-1987",
    customer: "Haruto Imai",
    device: "Hisense Fridge",
    issue: "Compressor noise",
    status: "QC review",
    technician: "Priya",
    priority: "Medium",
  },
] as const;

export const serviceRequests = [
  {
    ref: "KA-1024",
    customer: "Mason Brooks",
    device: "Air conditioner",
    issue: "No cooling after power dump",
    status: "New intake",
    urgency: "High",
  },
  {
    ref: "KA-1023",
    customer: "Elena Ortiz",
    device: "Laptop",
    issue: "Battery swelling concern",
    status: "Quoted",
    urgency: "Urgent",
  },
  {
    ref: "KA-1019",
    customer: "Kofi Mensah",
    device: "Microwave",
    issue: "Turntable not rotating",
    status: "Awaiting customer approval",
    urgency: "Medium",
  },
] as const;

export const customers = [
  {
    name: "Nadia Green",
    phone: "+1 (415) 440-9118",
    city: "San Francisco, CA",
    totalRepairs: 7,
    activeAssets: 3,
    lastVisit: "2 days ago",
    health: "Loyal",
  },
  {
    name: "Michael Chen",
    phone: "+1 (510) 201-4312",
    city: "Oakland, CA",
    totalRepairs: 5,
    activeAssets: 2,
    lastVisit: "5 days ago",
    health: "Watchlist",
  },
  {
    name: "Rosalind Price",
    phone: "+1 (917) 226-8840",
    city: "New York, NY",
    totalRepairs: 11,
    activeAssets: 4,
    lastVisit: "Today",
    health: "VIP",
  },
  {
    name: "Haruto Imai",
    phone: "+1 (650) 334-9801",
    city: "Santa Clara, CA",
    totalRepairs: 4,
    activeAssets: 1,
    lastVisit: "1 week ago",
    health: "Stable",
  },
] as const;

export const technicianTasks = [
  {
    crew: "Field tech – Samuel",
    jobId: "RF-2048",
    task: "Diagnose charging port issue and validate battery curves",
    status: "Ready to start",
    eta: "Today / 3:00 PM",
  },
  {
    crew: "Workshop – Alicia",
    jobId: "RF-2034",
    task: "Inspect drain pump and replace seal kit if required",
    status: "In progress",
    eta: "Today / 4:15 PM",
  },
  {
    crew: "Bench – Priya",
    jobId: "RF-1987",
    task: "Run compressor test and document before/after evidence",
    status: "QC pending",
    eta: "Tomorrow / 9:00 AM",
  },
] as const;

export const outcomeCards = [
  {
    title: "Confirmed positive outcome",
    value: "61.8%",
    detail: "42 of 68 valid responses",
    tone: "positive",
  },
  {
    title: "Same-symptom comeback",
    value: "11.3%",
    detail: "7 of 62 eligible cases",
    tone: "warning",
  },
  {
    title: "Unknown outcome",
    value: "21.7%",
    detail: "18 of 83 follow-ups due",
    tone: "neutral",
  },
] as const;

export const analyticsBreakdown = [
  {
    metric: "Confirmed outcome rate",
    numerator: "42",
    denominator: "68",
    rate: "61.8%",
    eligibleCases: 68,
    note: "",
  },
  {
    metric: "Same-symptom comeback rate",
    numerator: "7",
    denominator: "62",
    rate: "11.3%",
    eligibleCases: 62,
    note: "",
  },
  {
    metric: "Unknown outcome rate",
    numerator: "18",
    denominator: "83",
    rate: "21.7%",
    eligibleCases: 83,
    note: "",
  },
  {
    metric: "Different issue / new request rate",
    numerator: "3",
    denominator: "8",
    rate: "37.5%",
    eligibleCases: 8,
    note: "Early signal — insufficient sample.",
  },
] as const;

export const rolePermissions = [
  {
    role: "Owner / Admin",
    access: ["Finance", "QC", "Dispatch", "All dashboards"],
    tone: "primary",
  },
  {
    role: "Dispatcher / Service Desk",
    access: ["Intake", "Scheduling", "Request routing"],
    tone: "neutral",
  },
  {
    role: "Technician",
    access: ["Assigned jobs", "Repair logs", "Evidence upload"],
    tone: "success",
  },
  {
    role: "QC Reviewer",
    access: ["Checklists", "Pass/fail", "Comments & reworks"],
    tone: "warning",
  },
  {
    role: "Customer",
    access: ["Approval updates", "Repair status", "Follow-up response"],
    tone: "danger",
  },
] as const;

export const equipment = [
  {
    assetId: "AST-0284",
    customer: "Nadia Green",
    device: "Samsung Galaxy S23",
    category: "Mobile",
    serial: "R5CW41Q",
    repairs: 2,
  },
  {
    assetId: "AST-0271",
    customer: "Michael Chen",
    device: "LG Front Load Washer",
    category: "Appliance",
    serial: "WM4-9912",
    repairs: 3,
  },
  {
    assetId: "AST-0246",
    customer: "Rosalind Price",
    device: "Dell XPS 13",
    category: "Computer",
    serial: "DX-804112",
    repairs: 4,
  },
] as const;

export const quotations = [
  {
    reference: "QT-1048-v2",
    job: "RF-2048",
    customer: "Nadia Green",
    scope: "Charging port replacement",
    total: "$185.00",
    status: "Awaiting approval",
  },
  {
    reference: "QT-1034-v1",
    job: "RF-2034",
    customer: "Michael Chen",
    scope: "Drain pump inspection",
    total: "$240.00",
    status: "Approved",
  },
  {
    reference: "QT-1021-v3",
    job: "RF-2021",
    customer: "Rosalind Price",
    scope: "Motherboard repair",
    total: "$410.00",
    status: "Declined",
  },
] as const;

export const technicians = [
  {
    name: "Samuel Okafor",
    specialty: "Mobile devices",
    assigned: 8,
    status: "Available",
  },
  {
    name: "Alicia Martinez",
    specialty: "Large appliances",
    assigned: 6,
    status: "On a job",
  },
  {
    name: "Priya Shah",
    specialty: "Home appliances",
    assigned: 5,
    status: "Available",
  },
] as const;

export const qualityChecks = [
  {
    job: "RF-1987",
    device: "Hisense Fridge",
    technician: "Priya Shah",
    checklist: "Cooling cycle, temperature stability",
    status: "Ready for review",
  },
  {
    job: "RF-1968",
    device: "HP Envy 15",
    technician: "Samuel Okafor",
    checklist: "Boot test, ports, battery health",
    status: "Rework requested",
  },
] as const;

export const fixLoopFollowUps = [
  {
    job: "RF-1874",
    customer: "Haruto Imai",
    device: "Hisense Fridge",
    due: "Today",
    status: "Awaiting response",
  },
  {
    job: "RF-1859",
    customer: "Mason Brooks",
    device: "Window AC",
    due: "Tomorrow",
    status: "Response received",
  },
] as const;
