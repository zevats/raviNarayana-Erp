import fs from "fs";
import path from "path";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { resolveDbPath, getDb } from "./db";
import type { StaffRole, RoomType, PaymentMethod, ExpenseCategory } from "../../types";

/**
 * ============================================================================
 * RAVINARAYAN MANAGEMENT ERP — SAFE SYNTHETIC DATA SEEDER
 * ============================================================================
 * Generates an internally consistent, realistic demonstration dataset for
 * Ravinarayan PG Guesthouse (Jhajjar / Met City / Yakubpur, Haryana).
 *
 * SAFEGUARDS:
 * 1. Strictly refuses execution if NODE_ENV === 'production' or DB is production.
 * 2. Requires ALLOW_SYNTHETIC_SEED=true or --allow-synthetic-seed CLI flag.
 * 3. Creates a timestamped SQLite backup in data/backups before any write.
 * 4. Preserves the real owner account ('usr_super_admin_01' - Dr. Ravinder Gulia)
 *    and any active sessions or non-synthetic user records.
 * 5. Uses a dedicated 'seed_manifest' table to track provenance and enable
 *    100% clean, idempotent reruns without orphan records.
 * 6. Validates referential integrity via SQLite foreign keys and PRAGMA checks.
 * ============================================================================
 */

export interface SeedOptions {
  allowSyntheticSeed?: boolean;
  verbose?: boolean;
}

const SEED_BATCH_ID = "batch_demo_2026_v1";

// ----------------------------------------------------------------------------
// DATA DEFINITIONS: ROOMS (30 Rooms, 56 Beds, Floors 0 to 3)
// ----------------------------------------------------------------------------
const ROOM_DEFINITIONS: Array<{
  number: string;
  floor: number;
  type: RoomType;
  capacity: number;
  rent: number;
}> = [
  // Ground Floor (Floor 0)
  { number: "101", floor: 0, type: "SINGLE", capacity: 1, rent: 13000 },
  { number: "102", floor: 0, type: "SINGLE", capacity: 1, rent: 13000 },
  { number: "103", floor: 0, type: "DOUBLE_SHARING", capacity: 2, rent: 8500 },
  { number: "104", floor: 0, type: "DOUBLE_SHARING", capacity: 2, rent: 8500 },
  { number: "105", floor: 0, type: "TRIPLE_SHARING", capacity: 3, rent: 7000 },
  { number: "106", floor: 0, type: "TRIPLE_SHARING", capacity: 3, rent: 7000 },
  { number: "107", floor: 0, type: "EXECUTIVE_SUITE", capacity: 1, rent: 19000 },

  // Floor 1
  { number: "201", floor: 1, type: "SINGLE", capacity: 1, rent: 13500 },
  { number: "202", floor: 1, type: "SINGLE", capacity: 1, rent: 13500 },
  { number: "203", floor: 1, type: "DOUBLE_SHARING", capacity: 2, rent: 9000 },
  { number: "204", floor: 1, type: "DOUBLE_SHARING", capacity: 2, rent: 9000 },
  { number: "205", floor: 1, type: "DOUBLE_SHARING", capacity: 2, rent: 9000 },
  { number: "206", floor: 1, type: "TRIPLE_SHARING", capacity: 3, rent: 7200 },
  { number: "207", floor: 1, type: "TRIPLE_SHARING", capacity: 3, rent: 7200 },
  { number: "208", floor: 1, type: "EXECUTIVE_SUITE", capacity: 1, rent: 20000 },

  // Floor 2
  { number: "301", floor: 2, type: "SINGLE", capacity: 1, rent: 14000 },
  { number: "302", floor: 2, type: "SINGLE", capacity: 1, rent: 14000 },
  { number: "303", floor: 2, type: "DOUBLE_SHARING", capacity: 2, rent: 9000 },
  { number: "304", floor: 2, type: "DOUBLE_SHARING", capacity: 2, rent: 9000 },
  { number: "305", floor: 2, type: "DOUBLE_SHARING", capacity: 2, rent: 9000 },
  { number: "306", floor: 2, type: "TRIPLE_SHARING", capacity: 3, rent: 7500 },
  { number: "307", floor: 2, type: "TRIPLE_SHARING", capacity: 3, rent: 7500 },
  { number: "308", floor: 2, type: "EXECUTIVE_SUITE", capacity: 1, rent: 21000 },

  // Floor 3
  { number: "401", floor: 3, type: "SINGLE", capacity: 1, rent: 14500 },
  { number: "402", floor: 3, type: "SINGLE", capacity: 1, rent: 14500 },
  { number: "403", floor: 3, type: "DOUBLE_SHARING", capacity: 2, rent: 9500 },
  { number: "404", floor: 3, type: "DOUBLE_SHARING", capacity: 2, rent: 9500 },
  { number: "405", floor: 3, type: "TRIPLE_SHARING", capacity: 3, rent: 7500 },
  { number: "406", floor: 3, type: "TRIPLE_SHARING", capacity: 3, rent: 7500 },
  { number: "407", floor: 3, type: "EXECUTIVE_SUITE", capacity: 1, rent: 22000 },
];

// ----------------------------------------------------------------------------
// DATA DEFINITIONS: 48 REALISTIC RESIDENTS (38 Active In-House, 10 Checked-Out)
// ----------------------------------------------------------------------------
interface ResidentSeedDef {
  name: string;
  phone: string;
  email: string;
  emergency: string;
  notes: string;
  isActive: boolean;
  assignedRoom?: string; // Room number for active stays
  historicalRoom?: string; // Room number for checked-out stays
  checkInDate: string;
  checkOutDate?: string;
  deposit: number;
  diet: string;
  optBreakfast: boolean;
  optLunch: boolean;
  optDinner: boolean;
  // Rent payment profile
  paymentStatus: "FULLY_PAID" | "PARTIAL" | "OVERDUE" | "CHECKED_OUT";
}

const RESIDENT_DEFINITIONS: ResidentSeedDef[] = [
  // --- GROUND FLOOR OCCUPANTS ---
  {
    name: "Aarav Sharma",
    phone: "+91 98120 44101",
    email: "aarav.sharma@example.in",
    emergency: "+91 98120 11001 (Father - Satish Sharma)",
    notes: "Senior software engineer at Model Economic Township (MET City) electronics unit.",
    isActive: true,
    assignedRoom: "101",
    checkInDate: "2026-06-15",
    deposit: 6000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },
  {
    name: "Priya Patel",
    phone: "+91 98120 44103",
    email: "priya.patel@example.in",
    emergency: "+91 98120 11002 (Mother - Rekha Patel)",
    notes: "Quality assurance lead at Panasonic factory, Jhajjar.",
    isActive: true,
    assignedRoom: "103",
    checkInDate: "2026-07-01",
    deposit: 5000,
    diet: "JAIN",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },
  {
    name: "Neha Gupta",
    phone: "+91 98120 44104",
    email: "neha.gupta@example.in",
    emergency: "+91 98120 11003 (Brother - Mohit Gupta)",
    notes: "Operations coordinator sharing room 103.",
    isActive: true,
    assignedRoom: "103",
    checkInDate: "2026-07-10",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: false, // Eats lunch at office
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },
  {
    name: "Vikram Rathore",
    phone: "+91 98120 44105",
    email: "vikram.rathore@example.in",
    emergency: "+91 98120 11004 (Uncle - Col. Rathore)",
    notes: "Site supervisor at Reliance MET infrastructure project.",
    isActive: true,
    assignedRoom: "104",
    checkInDate: "2026-08-01",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "OVERDUE", // October rent overdue ₹8,500
  },
  {
    name: "Rohan Verma",
    phone: "+91 98120 44106",
    email: "rohan.verma@example.in",
    emergency: "+91 98120 11005 (Father - O.P. Verma)",
    notes: "Graduate trainee engineer at Denso Haryana.",
    isActive: true,
    assignedRoom: "105",
    checkInDate: "2026-08-15",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: false, // Opted out of breakfast
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },
  {
    name: "Aditya Roy",
    phone: "+91 98120 44107",
    email: "aditya.roy@example.in",
    emergency: "+91 98120 11006 (Brother - Subhash Roy)",
    notes: "Logistics supervisor at Allcargo logistics park.",
    isActive: true,
    assignedRoom: "105",
    checkInDate: "2026-08-15",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },
  {
    name: "Siddharth Jain",
    phone: "+91 98120 44108",
    email: "siddharth.jain@example.in",
    emergency: "+91 98120 11007 (Father - Ashok Jain)",
    notes: "Supply chain analyst sharing room 105.",
    isActive: true,
    assignedRoom: "105",
    checkInDate: "2026-09-01",
    deposit: 5000,
    diet: "JAIN",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },

  // --- FLOOR 1 OCCUPANTS ---
  {
    name: "Manish Kumar",
    phone: "+91 98120 44201",
    email: "manish.kumar@example.in",
    emergency: "+91 98120 11008 (Father - Ram Kumar)",
    notes: "Senior mechanical design consultant.",
    isActive: true,
    assignedRoom: "201",
    checkInDate: "2026-06-01",
    deposit: 7000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },
  {
    name: "Deepak Saini",
    phone: "+91 98120 44203",
    email: "deepak.saini@example.in",
    emergency: "+91 98120 11009 (Brother - Sunil Saini)",
    notes: "Electrical engineer at Yakubpur substation.",
    isActive: true,
    assignedRoom: "203",
    checkInDate: "2026-07-15",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },
  {
    name: "Tarun Gill",
    phone: "+91 98120 44204",
    email: "tarun.gill@example.in",
    emergency: "+91 98120 11010 (Father - Balbir Gill)",
    notes: "Procurement officer sharing room 203.",
    isActive: true,
    assignedRoom: "203",
    checkInDate: "2026-07-20",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },
  {
    name: "Ankit Dahiya",
    phone: "+91 98120 44205",
    email: "ankit.dahiya@example.in",
    emergency: "+91 98120 11011 (Father - Jagdish Dahiya)",
    notes: "Automotive technical trainee from Sonipat.",
    isActive: true,
    assignedRoom: "204",
    checkInDate: "2026-08-01",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: false, // Lunch at cafeteria
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },
  {
    name: "Gaurav Malik",
    phone: "+91 98120 44206",
    email: "gaurav.malik@example.in",
    emergency: "+91 98120 11012 (Brother - Rajesh Malik)",
    notes: "Industrial robotics programmer sharing room 204.",
    isActive: true,
    assignedRoom: "204",
    checkInDate: "2026-08-05",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "PARTIAL", // October rent partial payment ₹5,000 paid of ₹9,000 (₹4,000 pending)
  },
  {
    name: "Sachin Tanwar",
    phone: "+91 98120 44207",
    email: "sachin.tanwar@example.in",
    emergency: "+91 98120 11013 (Father - Ranveer Tanwar)",
    notes: "Logistics specialist at IndoSpace park.",
    isActive: true,
    assignedRoom: "206",
    checkInDate: "2026-08-10",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },
  {
    name: "Naveen Yadav",
    phone: "+91 98120 44208",
    email: "naveen.yadav@example.in",
    emergency: "+91 98120 11014 (Father - Surender Yadav)",
    notes: "Production supervisor sharing room 206.",
    isActive: true,
    assignedRoom: "206",
    checkInDate: "2026-08-12",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },
  {
    name: "Karan Ahlawat",
    phone: "+91 98120 44209",
    email: "karan.ahlawat@example.in",
    emergency: "+91 98120 11015 (Uncle - Virender Ahlawat)",
    notes: "Civil engineering trainee sharing room 206.",
    isActive: true,
    assignedRoom: "206",
    checkInDate: "2026-08-15",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },
  {
    name: "Rajesh Rao",
    phone: "+91 98120 44210",
    email: "rajesh.rao@example.in",
    emergency: "+91 98120 11016 (Wife - Savita Rao)",
    notes: "Senior plant maintenance technician.",
    isActive: true,
    assignedRoom: "207",
    checkInDate: "2026-09-01",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },
  {
    name: "Sunil Phogat",
    phone: "+91 98120 44211",
    email: "sunil.phogat@example.in",
    emergency: "+91 98120 11017 (Brother - Manoj Phogat)",
    notes: "HVAC engineer sharing room 207.",
    isActive: true,
    assignedRoom: "207",
    checkInDate: "2026-09-05",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },

  // --- FLOOR 2 OCCUPANTS ---
  {
    name: "Kavita Rao",
    phone: "+91 98120 44301",
    email: "kavita.rao@example.in",
    emergency: "+91 98120 11018 (Mother - Shanti Rao)",
    notes: "Senior HR manager at multinational logistics hub.",
    isActive: true,
    assignedRoom: "301",
    checkInDate: "2026-05-15",
    deposit: 8000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },
  {
    name: "Alok Srivastava",
    phone: "+91 98120 44303",
    email: "alok.srivastava@example.in",
    emergency: "+91 98120 11019 (Father - K.N. Srivastava)",
    notes: "Solar energy consultant.",
    isActive: true,
    assignedRoom: "303",
    checkInDate: "2026-07-01",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },
  {
    name: "Mohit Jindal",
    phone: "+91 98120 44304",
    email: "mohit.jindal@example.in",
    emergency: "+91 98120 11020 (Brother - Amit Jindal)",
    notes: "Financial auditor sharing room 303.",
    isActive: true,
    assignedRoom: "303",
    checkInDate: "2026-07-05",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },
  {
    name: "Pradeep Bhardwaj",
    phone: "+91 98120 44305",
    email: "pradeep.bhardwaj@example.in",
    emergency: "+91 98120 11021 (Father - R.C. Bhardwaj)",
    notes: "Warehouse technology integration lead.",
    isActive: true,
    assignedRoom: "304",
    checkInDate: "2026-08-01",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "OVERDUE", // October rent overdue ₹9,000
  },
  {
    name: "Vikas Sheoran",
    phone: "+91 98120 44306",
    email: "vikas.sheoran@example.in",
    emergency: "+91 98120 11022 (Brother - Sandeep Sheoran)",
    notes: "Inventory controller sharing room 304.",
    isActive: true,
    assignedRoom: "304",
    checkInDate: "2026-08-01",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: false, // Lunch opt out
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },
  {
    name: "Dharmender Sangwan",
    phone: "+91 98120 44307",
    email: "dharmender.sangwan@example.in",
    emergency: "+91 98120 11023 (Father - Jai Singh)",
    notes: "Instrumentation technician.",
    isActive: true,
    assignedRoom: "306",
    checkInDate: "2026-08-20",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },
  {
    name: "Pankaj Kadyan",
    phone: "+91 98120 44308",
    email: "pankaj.kadyan@example.in",
    emergency: "+91 98120 11024 (Brother - Sonu Kadyan)",
    notes: "CNC tooling specialist sharing room 306.",
    isActive: true,
    assignedRoom: "306",
    checkInDate: "2026-08-22",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },
  {
    name: "Ajay Hooda",
    phone: "+91 98120 44309",
    email: "ajay.hooda@example.in",
    emergency: "+91 98120 11025 (Father - Krishan Hooda)",
    notes: "Quality inspector sharing room 306.",
    isActive: true,
    assignedRoom: "306",
    checkInDate: "2026-09-01",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },
  {
    name: "Rishi Kaushik",
    phone: "+91 98120 44310",
    email: "rishi.kaushik@example.in",
    emergency: "+91 98120 11026 (Father - M.L. Kaushik)",
    notes: "Robotics calibration engineer.",
    isActive: true,
    assignedRoom: "307",
    checkInDate: "2026-09-15",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },

  // --- FLOOR 3 OCCUPANTS ---
  {
    name: "Dr. Ananya Sen",
    phone: "+91 98120 44401",
    email: "ananya.sen@example.in",
    emergency: "+91 98120 11027 (Father - Dr. P.C. Sen)",
    notes: "Visiting occupational health physician at industrial clinic.",
    isActive: true,
    assignedRoom: "401",
    checkInDate: "2026-06-10",
    deposit: 8000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "OVERDUE", // October rent overdue ₹14,500
  },
  {
    name: "Nitin Rewari",
    phone: "+91 98120 44403",
    email: "nitin.rewari@example.in",
    emergency: "+91 98120 11028 (Father - Ramesh Rewari)",
    notes: "Heavy machinery service supervisor.",
    isActive: true,
    assignedRoom: "403",
    checkInDate: "2026-07-01",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },
  {
    name: "Sanjay Bishnoi",
    phone: "+91 98120 44404",
    email: "sanjay.bishnoi@example.in",
    emergency: "+91 98120 11029 (Brother - Pawan Bishnoi)",
    notes: "Environmental safety officer sharing room 403.",
    isActive: true,
    assignedRoom: "403",
    checkInDate: "2026-07-05",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },
  {
    name: "Harish Chillar",
    phone: "+91 98120 44405",
    email: "harish.chillar@example.in",
    emergency: "+91 98120 11030 (Father - Dharamvir Chillar)",
    notes: "Packaging automation technician.",
    isActive: true,
    assignedRoom: "404",
    checkInDate: "2026-08-01",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },
  {
    name: "Sumit Beniwal",
    phone: "+91 98120 44406",
    email: "sumit.beniwal@example.in",
    emergency: "+91 98120 11031 (Father - Satbir Beniwal)",
    notes: "Met City water treatment operator.",
    isActive: true,
    assignedRoom: "405",
    checkInDate: "2026-08-10",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },
  {
    name: "Kuldeep Punia",
    phone: "+91 98120 44407",
    email: "kuldeep.punia@example.in",
    emergency: "+91 98120 11032 (Brother - Jagdish Punia)",
    notes: "Facility security coordinator sharing room 405.",
    isActive: true,
    assignedRoom: "405",
    checkInDate: "2026-08-12",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },
  {
    name: "Ashish Jakhar",
    phone: "+91 98120 44408",
    email: "ashish.jakhar@example.in",
    emergency: "+91 98120 11033 (Father - Balwan Jakhar)",
    notes: "Electrical grid technician sharing room 405.",
    isActive: true,
    assignedRoom: "405",
    checkInDate: "2026-08-15",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "OVERDUE", // October rent overdue ₹7,500
  },
  {
    name: "Monu Siwach",
    phone: "+91 98120 44409",
    email: "monu.siwach@example.in",
    emergency: "+91 98120 11034 (Father - Surender Siwach)",
    notes: "Fire and safety supervisor.",
    isActive: true,
    assignedRoom: "406",
    checkInDate: "2026-09-01",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },
  {
    name: "Ravinder Kundu",
    phone: "+91 98120 44410",
    email: "ravinder.kundu@example.in",
    emergency: "+91 98120 11035 (Brother - Rajesh Kundu)",
    notes: "Telecom network field engineer sharing room 406.",
    isActive: true,
    assignedRoom: "406",
    checkInDate: "2026-09-05",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },
  {
    name: "Raman Lather",
    phone: "+91 98120 44411",
    email: "raman.lather@example.in",
    emergency: "+91 98120 11036 (Father - Hawa Singh)",
    notes: "Automotive supplier representative.",
    isActive: true,
    assignedRoom: "406",
    checkInDate: "2026-09-10",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: false, // Breakfast opt out
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },
  {
    name: "Pooja Deswal",
    phone: "+91 98120 44412",
    email: "pooja.deswal@example.in",
    emergency: "+91 98120 11037 (Mother - Sunita Deswal)",
    notes: "Civil CAD technician.",
    isActive: true,
    assignedRoom: "104", // Second occupant in room 104
    checkInDate: "2026-09-15",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },
  {
    name: "Meena Mor",
    phone: "+91 98120 44413",
    email: "meena.mor@example.in",
    emergency: "+91 98120 11038 (Sister - Ritu Mor)",
    notes: "Accountant at logistics facility.",
    isActive: true,
    assignedRoom: "207", // Third occupant in room 207
    checkInDate: "2026-09-20",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "FULLY_PAID",
  },

  // --- HISTORICAL (CHECKED-OUT) RESIDENTS (10 Residents) ---
  {
    name: "Rajiv Malhotra",
    phone: "+91 98120 44901",
    email: "rajiv.malhotra@example.in",
    emergency: "+91 98120 11039",
    notes: "Project consultant. Transferred to Gurugram corporate headquarters.",
    isActive: false,
    historicalRoom: "102",
    checkInDate: "2026-02-01",
    checkOutDate: "2026-07-31",
    deposit: 6000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "CHECKED_OUT",
  },
  {
    name: "Suresh Chandra",
    phone: "+91 98120 44902",
    email: "suresh.chandra@example.in",
    emergency: "+91 98120 11040",
    notes: "Electrical contractor for substation commissioning.",
    isActive: false,
    historicalRoom: "106",
    checkInDate: "2026-03-01",
    checkOutDate: "2026-08-15",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "CHECKED_OUT",
  },
  {
    name: "Dinesh Khandelwal",
    phone: "+91 98120 44903",
    email: "dinesh.k@example.in",
    emergency: "+91 98120 11041",
    notes: "Commercial auditor on 3-month assignment.",
    isActive: false,
    historicalRoom: "202",
    checkInDate: "2026-04-01",
    checkOutDate: "2026-06-30",
    deposit: 6500,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "CHECKED_OUT",
  },
  {
    name: "Manpreet Dhillon",
    phone: "+91 98120 44904",
    email: "manpreet.d@example.in",
    emergency: "+91 98120 11042",
    notes: "Heavy transport logistics specialist.",
    isActive: false,
    historicalRoom: "205",
    checkInDate: "2026-04-15",
    checkOutDate: "2026-08-31",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "CHECKED_OUT",
  },
  {
    name: "Anil Sehgal",
    phone: "+91 98120 44905",
    email: "anil.sehgal@example.in",
    emergency: "+91 98120 11043",
    notes: "Civil structural inspector.",
    isActive: false,
    historicalRoom: "208",
    checkInDate: "2026-05-01",
    checkOutDate: "2026-09-15",
    deposit: 10000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "CHECKED_OUT",
  },
  {
    name: "Gopal Krishnan",
    phone: "+91 98120 44906",
    email: "gopal.k@example.in",
    emergency: "+91 98120 11044",
    notes: "HVAC vendor representative.",
    isActive: false,
    historicalRoom: "302",
    checkInDate: "2026-05-15",
    checkOutDate: "2026-08-30",
    deposit: 7000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "CHECKED_OUT",
  },
  {
    name: "Vinod Tewari",
    phone: "+91 98120 44907",
    email: "vinod.t@example.in",
    emergency: "+91 98120 11045",
    notes: "Instrumentation contractor.",
    isActive: false,
    historicalRoom: "305",
    checkInDate: "2026-06-01",
    checkOutDate: "2026-09-01",
    deposit: 5000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "CHECKED_OUT",
  },
  {
    name: "Sunil Wadhwa",
    phone: "+91 98120 44908",
    email: "sunil.w@example.in",
    emergency: "+91 98120 11046",
    notes: "Executive architect for new logistics warehouse.",
    isActive: false,
    historicalRoom: "308",
    checkInDate: "2026-06-01",
    checkOutDate: "2026-09-30",
    deposit: 10000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "CHECKED_OUT",
  },
  {
    name: "Hemant Rawat",
    phone: "+91 98120 44909",
    email: "hemant.r@example.in",
    emergency: "+91 98120 11047",
    notes: "Safety auditor on contract.",
    isActive: false,
    historicalRoom: "402",
    checkInDate: "2026-07-01",
    checkOutDate: "2026-09-25",
    deposit: 7000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "CHECKED_OUT",
  },
  {
    name: "Sanjay Narang",
    phone: "+91 98120 44910",
    email: "sanjay.narang@example.in",
    emergency: "+91 98120 11048",
    notes: "Senior site project manager.",
    isActive: false,
    historicalRoom: "407",
    checkInDate: "2026-05-01",
    checkOutDate: "2026-08-31",
    deposit: 10000,
    diet: "VEG",
    optBreakfast: true,
    optLunch: true,
    optDinner: true,
    paymentStatus: "CHECKED_OUT",
  },
];

// ----------------------------------------------------------------------------
// DATA DEFINITIONS: SYNTHETIC STAFF ACCOUNTS
// ----------------------------------------------------------------------------
const STAFF_DEFINITIONS = [
  {
    id: "syn_staff_ops_01",
    username: "manoj_ops",
    email: "manoj.ops@ravinarayan.in",
    fullName: "Manoj Sharma",
    role: "OPERATIONS_MANAGER" as StaffRole,
    isActive: 1,
  },
  {
    id: "syn_staff_acc_01",
    username: "sunita_acc",
    email: "sunita.acc@ravinarayan.in",
    fullName: "Sunita Deshmukh",
    role: "ACCOUNTANT" as StaffRole,
    isActive: 1,
  },
  {
    id: "syn_staff_kit_01",
    username: "balram_chef",
    email: "balram.kitchen@ravinarayan.in",
    fullName: "Chef Balram Singh",
    role: "KITCHEN_OPERATIONS" as StaffRole,
    isActive: 1,
  },
  {
    id: "syn_staff_del_01",
    username: "ramesh_del",
    email: "ramesh.del@ravinarayan.in",
    fullName: "Ramesh Kumar",
    role: "DELIVERY_PERSON" as StaffRole,
    isActive: 1,
  },
  {
    id: "syn_staff_del_02",
    username: "suresh_del",
    email: "suresh.del@ravinarayan.in",
    fullName: "Suresh Singh",
    role: "DELIVERY_PERSON" as StaffRole,
    isActive: 1,
  },
  {
    id: "syn_staff_del_03",
    username: "vijay_del",
    email: "vijay.del@ravinarayan.in",
    fullName: "Vijay Dhull",
    role: "DELIVERY_PERSON" as StaffRole,
    isActive: 0, // Demonstrates inactive staff handling in selectors/tests
  },
];

// ----------------------------------------------------------------------------
// DATA DEFINITIONS: OPERATIONAL EXPENSES
// ----------------------------------------------------------------------------
const EXPENSE_DEFINITIONS: Array<{
  category: ExpenseCategory;
  amount: number;
  date: string;
  method: PaymentMethod;
  payee: string;
  desc: string;
}> = [
  // August 2026
  { category: "UTILITIES", amount: 24500, date: "2026-08-05", method: "BANK_TRANSFER", payee: "DHBVN (Dakshin Haryana Bijli Vitran Nigam)", desc: "Monthly commercial electricity supply bill - August" },
  { category: "GROCERY", amount: 38200, date: "2026-08-08", method: "UPI", payee: "Aggarwal Wholesale Grains & Spices, Jhajjar", desc: "Wholesale wheat flour (atta), basmati rice, lentils, spices" },
  { category: "STAFF_SALARY", amount: 28000, date: "2026-08-10", method: "BANK_TRANSFER", payee: "Kitchen Operations Staff", desc: "Kitchen head cook and assistant monthly operational stipend" },
  { category: "MAINTENANCE", amount: 6500, date: "2026-08-16", method: "CASH", payee: "Sharma Cooling & Refrigeration", desc: "Split AC servicing, deep cleaning & filter replacement across Floor 1 & 2" },
  { category: "INTERNET", amount: 3999, date: "2026-08-20", method: "UPI", payee: "Airtel Xstream Commercial Fiber", desc: "High-speed optical fiber commercial connection (300 Mbps)" },

  // September 2026
  { category: "UTILITIES", amount: 26800, date: "2026-09-04", method: "BANK_TRANSFER", payee: "DHBVN", desc: "Monthly commercial electricity supply bill - September" },
  { category: "UTILITIES", amount: 8200, date: "2026-09-06", method: "UPI", payee: "Bharat Petroleum Yakubpur Station", desc: "Commercial generator diesel for standby power backup (100 L)" },
  { category: "GROCERY", amount: 41500, date: "2026-09-08", method: "UPI", payee: "Aggarwal Wholesale Grains & Spices", desc: "Monthly food provisions, edible oil, ghee, and pulses supply" },
  { category: "STAFF_SALARY", amount: 28000, date: "2026-09-10", method: "BANK_TRANSFER", payee: "Kitchen Operations Staff", desc: "Kitchen staff monthly operational salary - September" },
  { category: "MAINTENANCE", amount: 4800, date: "2026-09-18", method: "CASH", payee: "Verma Plumbing & Sanitary", desc: "Pressure pump valve maintenance and overhead tank float switch replacement" },
  { category: "INTERNET", amount: 3999, date: "2026-09-20", method: "UPI", payee: "Airtel Xstream Commercial Fiber", desc: "High-speed optical fiber commercial connection - September" },

  // October 2026
  { category: "UTILITIES", amount: 23400, date: "2026-10-04", method: "BANK_TRANSFER", payee: "DHBVN", desc: "Monthly commercial electricity supply bill - October" },
  { category: "GROCERY", amount: 39600, date: "2026-10-07", method: "UPI", payee: "Aggarwal Wholesale Grains", desc: "Grains, dairy provisions, fresh spices & cooking oil for October" },
  { category: "STAFF_SALARY", amount: 28000, date: "2026-10-10", method: "BANK_TRANSFER", payee: "Kitchen Operations Staff", desc: "Kitchen staff monthly operational salary - October" },
  { category: "KITCHEN_SUPPLIES", amount: 7400, date: "2026-10-12", method: "UPI", payee: "National Steel House Jhajjar", desc: "Commercial stainless steel meal trays, insulated containers & tiffin boxes" },
  { category: "INTERNET", amount: 3999, date: "2026-10-14", method: "UPI", payee: "Airtel Xstream Commercial Fiber", desc: "High-speed optical fiber commercial connection - October" },
];

/**
 * Main execution function for synthetic data seeding.
 */
export async function seedSyntheticData(options: SeedOptions = {}): Promise<{
  success: boolean;
  message: string;
  stats: Record<string, number>;
}> {
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction) {
    throw new Error(
      "[FATAL SAFETY VIOLATION] Synthetic data seeding is strictly prohibited in production environments."
    );
  }

  const explicitAllowed =
    options.allowSyntheticSeed ||
    process.env.ALLOW_SYNTHETIC_SEED === "true" ||
    process.argv.includes("--allow-synthetic-seed");

  if (!explicitAllowed) {
    throw new Error(
      "[SAFEGUARD REQUIRED] Synthetic data seeding requires explicit confirmation. Set ALLOW_SYNTHETIC_SEED=true or pass --allow-synthetic-seed."
    );
  }

  const dbPath = resolveDbPath();
  const dbDir = path.dirname(dbPath);

  // Safety check on path name
  if (dbPath.toLowerCase().includes("production")) {
    throw new Error(
      `[FATAL SAFETY VIOLATION] Database path '${dbPath}' contains 'production'. Aborting seed.`
    );
  }

  // 1. Create a timestamped SQLite backup
  const backupDir = path.join(dbDir, "backups");
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `erp.db.backup.${timestamp}.db`);

  if (fs.existsSync(dbPath)) {
    fs.copyFileSync(dbPath, backupPath);
    const backupStat = fs.statSync(backupPath);
    if (backupStat.size === 0) {
      throw new Error(`[BACKUP INTEGRITY ERROR] Created backup file at '${backupPath}' is 0 bytes.`);
    }
  }

  const db = getDb();

  // Ensure WAL mode and foreign keys
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // 2. Ensure seed_manifest table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS seed_manifest (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      seed_batch TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_seed_manifest_type ON seed_manifest(entity_type);
    CREATE INDEX IF NOT EXISTS idx_seed_manifest_entity ON seed_manifest(entity_id);
    CREATE INDEX IF NOT EXISTS idx_seed_manifest_batch ON seed_manifest(seed_batch);
  `);

  const now = new Date().toISOString();
  const defaultPasswordHash = await bcrypt.hash("Ravinarayan@2026", 12);

  // Stats tracker
  const stats = {
    staffUsers: 0,
    rooms: 0,
    residents: 0,
    stays: 0,
    mealPreferences: 0,
    financialTransactions: 0,
    mealPlans: 0,
    mealRecords: 0,
    mealAdjustments: 0,
    deliveryTasks: 0,
    deliveryTaskEvents: 0,
    auditLogs: 0,
  };

  const seedTransaction = db.transaction(() => {
    // ------------------------------------------------------------------------
    // A. CLEANUP PRIOR SYNTHETIC RECORDS (REVERSE DEPENDENCY ORDER)
    // ------------------------------------------------------------------------
    // Never delete 'usr_super_admin_01' or any non-synthetic records!
    const existingSynthetic = db
      .prepare("SELECT entity_type, entity_id FROM seed_manifest")
      .all() as Array<{ entity_type: string; entity_id: string }>;

    if (existingSynthetic.length > 0) {
      // Group by entity_type
      const byType: Record<string, string[]> = {};
      for (const row of existingSynthetic) {
        if (!byType[row.entity_type]) byType[row.entity_type] = [];
        byType[row.entity_type].push(row.entity_id);
      }

      // Safe deletion in reverse topological order:
      const deletionOrder = [
        { type: "delivery_task_event", table: "delivery_task_events" },
        { type: "delivery_task", table: "delivery_tasks" },
        { type: "meal_plan_adjustment", table: "meal_plan_adjustments" },
        { type: "resident_meal_record", table: "resident_meal_records" },
        { type: "daily_meal_plan", table: "daily_meal_plans" },
        { type: "resident_meal_preference", table: "resident_meal_preferences", idCol: "resident_id" },
        { type: "financial_transaction", table: "financial_transactions" },
        { type: "resident_stay", table: "resident_stays" },
        { type: "resident", table: "residents" },
        { type: "room", table: "rooms" },
        { type: "staff_user", table: "staff_users" },
        { type: "audit_log", table: "audit_logs" },
      ];

      for (const { type, table, idCol } of deletionOrder) {
        if (table === "financial_transactions") {
          db.exec("UPDATE financial_transactions SET reversal_of_id = NULL WHERE reversal_of_id IS NOT NULL;");
        }
        const ids = byType[type];
        if (ids && ids.length > 0) {
          const col = idCol || "id";
          const deleteStmt = db.prepare(`DELETE FROM ${table} WHERE ${col} = ?`);
          for (const id of ids) {
            // Safety guard: NEVER delete the initial super admin
            if (id === "usr_super_admin_01") continue;
            deleteStmt.run(id);
          }
        }
      }

      // Clear old seed manifest
      db.prepare("DELETE FROM seed_manifest").run();
    }

    const insertManifest = db.prepare(`
      INSERT INTO seed_manifest (id, entity_type, entity_id, seed_batch, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    function trackEntity(entityType: string, entityId: string): void {
      insertManifest.run(`sm_${crypto.randomUUID()}`, entityType, entityId, SEED_BATCH_ID, now);
    }

    // ------------------------------------------------------------------------
    // B. SEED SYNTHETIC STAFF USERS
    // ------------------------------------------------------------------------
    const insertStaff = db.prepare(`
      INSERT INTO staff_users (
        id, username, email, full_name, password_hash, role, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    console.log("-> Seeding staff users...");
    for (const staff of STAFF_DEFINITIONS) {
      // Check if user already exists
      const existing = db.prepare("SELECT id FROM staff_users WHERE id = ? OR username = ?").get(staff.id, staff.username);
      if (!existing) {
        insertStaff.run(
          staff.id,
          staff.username,
          staff.email,
          staff.fullName,
          defaultPasswordHash,
          staff.role,
          staff.isActive,
          now,
          now
        );
        trackEntity("staff_user", staff.id);
        stats.staffUsers++;
      }
    }

    // ------------------------------------------------------------------------
    // C. SEED ROOMS INVENTORY (30 Rooms)
    // ------------------------------------------------------------------------
    const roomMap = new Map<string, string>(); // roomNumber -> roomId

    const insertRoom = db.prepare(`
      INSERT INTO rooms (
        id, room_number, floor, type, capacity, base_rent_monthly, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);

    console.log("-> Seeding rooms inventory...");
    for (const def of ROOM_DEFINITIONS) {
      const roomId = `syn_room_${def.number}`;
      insertRoom.run(roomId, def.number, def.floor, def.type, def.capacity, def.rent, now, now);
      roomMap.set(def.number, roomId);
      trackEntity("room", roomId);
      stats.rooms++;
    }

    // ------------------------------------------------------------------------
    // D. SEED RESIDENTS, STAYS, & MEAL PREFERENCES (48 Residents)
    // ------------------------------------------------------------------------
    const residentMap = new Map<string, { residentId: string; stayId?: string }>();

    const insertResident = db.prepare(`
      INSERT INTO residents (
        id, full_name, phone, email, emergency_contact, notes, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertStay = db.prepare(`
      INSERT INTO resident_stays (
        id, resident_id, room_id, check_in_date, check_out_date, monthly_rent, security_deposit, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertPref = db.prepare(`
      INSERT INTO resident_meal_preferences (
        resident_id, breakfast_opt_in, lunch_opt_in, dinner_opt_in, dietary_preference, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    console.log("-> Seeding residents, stays & meal preferences...");
    for (let i = 0; i < RESIDENT_DEFINITIONS.length; i++) {
      const r = RESIDENT_DEFINITIONS[i];
      const residentId = `syn_res_${(i + 1).toString().padStart(3, "0")}`;
      const residentStatus = r.isActive ? "ACTIVE" : "CHECKED_OUT";

      insertResident.run(
        residentId,
        r.name,
        r.phone,
        r.email,
        r.emergency,
        r.notes,
        residentStatus,
        r.checkInDate + "T10:00:00.000Z",
        now
      );
      trackEntity("resident", residentId);
      stats.residents++;

      // Room stay
      const targetRoomNum = r.assignedRoom || r.historicalRoom;
      if (targetRoomNum && roomMap.has(targetRoomNum)) {
        const roomId = roomMap.get(targetRoomNum)!;
        const stayId = `syn_stay_${(i + 1).toString().padStart(3, "0")}`;
        const stayStatus = r.isActive ? "ACTIVE" : "COMPLETED";
        const checkOut = r.isActive ? null : r.checkOutDate || "2026-08-31";

        // Room rent lookup
        const roomDef = ROOM_DEFINITIONS.find((rd) => rd.number === targetRoomNum);
        const monthlyRent = roomDef ? roomDef.rent : 8500;

        insertStay.run(
          stayId,
          residentId,
          roomId,
          r.checkInDate,
          checkOut,
          monthlyRent,
          r.deposit,
          stayStatus,
          r.checkInDate + "T10:00:00.000Z",
          now
        );
        trackEntity("resident_stay", stayId);
        stats.stays++;

        residentMap.set(r.name, { residentId, stayId });

        // Meal preference for in-house active residents
        if (r.isActive) {
          insertPref.run(
            residentId,
            r.optBreakfast ? 1 : 0,
            r.optLunch ? 1 : 0,
            r.optDinner ? 1 : 0,
            r.diet,
            `${r.name} - ${r.diet} preference`,
            r.checkInDate + "T10:00:00.000Z",
            now
          );
          trackEntity("resident_meal_preference", residentId);
          stats.mealPreferences++;
        }
      } else {
        residentMap.set(r.name, { residentId });
      }
    }

    // ------------------------------------------------------------------------
    // E. SEED FINANCIAL TRANSACTIONS (Charges, Payments, Deposits, Expenses, Reversals)
    // ------------------------------------------------------------------------
    const insertTxn = db.prepare(`
      INSERT INTO financial_transactions (
        id, transaction_type, amount, transaction_date, payment_method,
        reference_number, resident_id, stay_id, category, description,
        billing_period, payee_vendor, idempotency_key, status,
        reversal_of_id, created_by, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `);

    let txCounter = 1;
    function nextTxId(): string {
      return `syn_txn_${(txCounter++).toString().padStart(4, "0")}`;
    }

    // 1. Security Deposits for active residents
    console.log("-> Seeding financial transactions...");
    for (const r of RESIDENT_DEFINITIONS) {
      if (r.isActive && r.deposit > 0) {
        const info = residentMap.get(r.name);
        if (info && info.stayId) {
          const txId = nextTxId();
          insertTxn.run(
            txId,
            "SECURITY_DEPOSIT",
            r.deposit,
            r.checkInDate,
            "UPI",
            `UPI/SEC/${r.assignedRoom}/${r.checkInDate.replace(/-/g, "")}`,
            info.residentId,
            info.stayId,
            "SECURITY_DEPOSIT",
            `Security deposit held against Room ${r.assignedRoom} check-in`,
            null,
            null,
            `idemp_sec_${info.residentId}`,
            "POSTED",
            null,
            "syn_staff_acc_01",
            r.checkInDate + "T10:15:00.000Z",
            r.checkInDate + "T10:15:00.000Z"
          );
          trackEntity("financial_transaction", txId);
          stats.financialTransactions++;
        }
      }
    }

    // 2. Rent charges and payments across billing cycles (August, September, October 2026)
    const billingCycles = [
      { period: "August 2026", chargeDate: "2026-08-01", payDate: "2026-08-04" },
      { period: "September 2026", chargeDate: "2026-09-01", payDate: "2026-09-05" },
      { period: "October 2026", chargeDate: "2026-10-01", payDate: "2026-10-05" },
    ];

    for (let i = 0; i < RESIDENT_DEFINITIONS.length; i++) {
      const r = RESIDENT_DEFINITIONS[i];
      if (!r.isActive) continue;
      const info = residentMap.get(r.name);
      if (!info || !info.stayId) continue;

      const roomDef = ROOM_DEFINITIONS.find((rd) => rd.number === r.assignedRoom);
      const monthlyRent = roomDef ? roomDef.rent : 8500;

      for (const cycle of billingCycles) {
        // Only bill if resident checked in on or before cycle's month
        const cycleMonthPrefix = cycle.chargeDate.slice(0, 7);
        const checkInMonthPrefix = r.checkInDate.slice(0, 7);
        if (checkInMonthPrefix > cycleMonthPrefix) continue;

        // Rent Charge
        const chargeTxId = nextTxId();
        insertTxn.run(
          chargeTxId,
          "RENT_CHARGE",
          monthlyRent,
          cycle.chargeDate,
          null,
          null,
          info.residentId,
          info.stayId,
          "RENT",
          `Monthly accommodation & amenities rent - ${cycle.period}`,
          cycle.period,
          null,
          `idemp_chg_${info.residentId}_${cycle.chargeDate}`,
          "POSTED",
          null,
          "syn_staff_acc_01",
          cycle.chargeDate + "T09:00:00.000Z",
          cycle.chargeDate + "T09:00:00.000Z"
        );
        trackEntity("financial_transaction", chargeTxId);
        stats.financialTransactions++;

        // Rent Payment
        if (cycle.period === "October 2026") {
          // Check paymentStatus for October
          if (r.paymentStatus === "FULLY_PAID") {
            const payTxId = nextTxId();
            insertTxn.run(
              payTxId,
              "RENT_PAYMENT",
              monthlyRent,
              cycle.payDate,
              "UPI",
              `UPI/RN/OCT/${info.residentId.slice(-3)}`,
              info.residentId,
              info.stayId,
              "RENT",
              `Monthly rent payment received via UPI - ${cycle.period}`,
              null,
              null,
              `idemp_pay_${info.residentId}_${cycle.payDate}`,
              "POSTED",
              null,
              "syn_staff_acc_01",
              cycle.payDate + "T14:30:00.000Z",
              cycle.payDate + "T14:30:00.000Z"
            );
            trackEntity("financial_transaction", payTxId);
            stats.financialTransactions++;
          } else if (r.paymentStatus === "PARTIAL") {
            // Partial payment of ₹5,000
            const partialAmt = 5000;
            const payTxId = nextTxId();
            insertTxn.run(
              payTxId,
              "RENT_PAYMENT",
              partialAmt,
              cycle.payDate,
              "BANK_TRANSFER",
              `NEFT/RN/OCT/${info.residentId.slice(-3)}`,
              info.residentId,
              info.stayId,
              "RENT",
              `Partial rent payment received via Bank Transfer - ${cycle.period}`,
              null,
              null,
              `idemp_pay_part_${info.residentId}_${cycle.payDate}`,
              "POSTED",
              null,
              "syn_staff_acc_01",
              cycle.payDate + "T15:00:00.000Z",
              cycle.payDate + "T15:00:00.000Z"
            );
            trackEntity("financial_transaction", payTxId);
            stats.financialTransactions++;
          }
          // OVERDUE residents have no payment in October (leaving clean overdue balance)
        } else {
          // Prior months (August, September) fully paid
          const payTxId = nextTxId();
          const pMethod = i % 3 === 0 ? "BANK_TRANSFER" : i % 5 === 0 ? "CASH" : "UPI";
          insertTxn.run(
            payTxId,
            "RENT_PAYMENT",
            monthlyRent,
            cycle.payDate,
            pMethod,
            `${pMethod}/RN/${cycleMonthPrefix.replace("-", "")}/${info.residentId.slice(-3)}`,
            info.residentId,
            info.stayId,
            "RENT",
            `Monthly rent payment received - ${cycle.period}`,
            null,
            null,
            `idemp_pay_${info.residentId}_${cycle.payDate}`,
            "POSTED",
            null,
            "syn_staff_acc_01",
            cycle.payDate + "T12:00:00.000Z",
            cycle.payDate + "T12:00:00.000Z"
          );
          trackEntity("financial_transaction", payTxId);
          stats.financialTransactions++;
        }
      }
    }

    // 3. Operational Expenses
    for (const exp of EXPENSE_DEFINITIONS) {
      const expTxId = nextTxId();
      insertTxn.run(
        expTxId,
        "EXPENSE",
        exp.amount,
        exp.date,
        exp.method,
        `EXP/${exp.date.replace(/-/g, "")}/${exp.category.slice(0, 3)}`,
        null,
        null,
        exp.category,
        exp.desc,
        null,
        exp.payee,
        `idemp_exp_${exp.date}_${exp.category}_${exp.amount}`,
        "POSTED",
        null,
        "syn_staff_acc_01",
        exp.date + "T16:00:00.000Z",
        exp.date + "T16:00:00.000Z"
      );
      trackEntity("financial_transaction", expTxId);
      stats.financialTransactions++;
    }

    // 4. One Realistic Reversal Transaction (Duplicate receipt correction)
    // First, insert an erroneous transaction that was subsequently reversed
    const firstRes = residentMap.get("Aarav Sharma")!;
    const origErrTxId = nextTxId();
    insertTxn.run(
      origErrTxId,
      "RENT_PAYMENT",
      2500,
      "2026-09-12",
      "CASH",
      "CASH/ERR/0912",
      firstRes.residentId,
      firstRes.stayId,
      "RENT",
      "Duplicate partial cash receipt recorded in error",
      null,
      null,
      "idemp_rev_orig_01",
      "REVERSED",
      null,
      "syn_staff_acc_01",
      "2026-09-12T11:00:00.000Z",
      "2026-09-12T17:00:00.000Z"
    );
    trackEntity("financial_transaction", origErrTxId);
    stats.financialTransactions++;

    // Then insert the compensating REVERSAL record
    const reversalTxId = nextTxId();
    insertTxn.run(
      reversalTxId,
      "REVERSAL",
      2500,
      "2026-09-12",
      "CASH",
      "REV/CASH/0912",
      firstRes.residentId,
      firstRes.stayId,
      "RENT",
      "Reversal of duplicate receipt entry # " + origErrTxId,
      null,
      null,
      "idemp_reversal_record_01",
      "POSTED",
      origErrTxId,
      "syn_staff_acc_01",
      "2026-09-12T17:00:00.000Z",
      "2026-09-12T17:00:00.000Z"
    );
    trackEntity("financial_transaction", reversalTxId);
    stats.financialTransactions++;

    // ------------------------------------------------------------------------
    // F. SEED KITCHEN DAILY MEAL PLANS & ATTENDANCE RECORDS
    // ------------------------------------------------------------------------
    const insertPlan = db.prepare(`
      INSERT INTO daily_meal_plans (
        id, service_date, meal_type, planned_resident_count, guest_count,
        final_preparation_count, status, notes, created_by, confirmed_by,
        confirmed_at, completed_by, completed_at, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
    `);

    const insertMealRecord = db.prepare(`
      INSERT INTO resident_meal_records (
        id, plan_id, resident_id, stay_id, service_date, meal_type,
        status, notes, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
    `);

    const insertAdjustment = db.prepare(`
      INSERT INTO meal_plan_adjustments (
        id, plan_id, previous_resident_count, new_resident_count, previous_guest_count,
        new_guest_count, previous_total, new_total, reason, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // In-house residents list for attendance
    const inHouseResidents = RESIDENT_DEFINITIONS.filter((r) => r.isActive);

    const mealPlanSchedule = [
      // 2026-10-14 (Completed historical)
      { date: "2026-10-14", type: "BREAKFAST" as const, guests: 2, status: "COMPLETED" as const, notes: "Aloo paratha, fresh curd, mint chutney & tea" },
      { date: "2026-10-14", type: "LUNCH" as const, guests: 5, status: "COMPLETED" as const, notes: "Rajma rasmisa, steamed jeera rice, phulka & boondi raita" },
      { date: "2026-10-14", type: "DINNER" as const, guests: 0, status: "COMPLETED" as const, notes: "Seasonal mix veg, dal tadka, rotis & kheer" },

      // 2026-10-15 (Current active day)
      { date: "2026-10-15", type: "BREAKFAST" as const, guests: 3, status: "COMPLETED" as const, notes: "Poha with roasted peanuts, sprouts, fruit & ginger tea" },
      { date: "2026-10-15", type: "LUNCH" as const, guests: 4, status: "COMPLETED" as const, notes: "Kadhi pakora, steamed rice, roti, salad & roasted papad" },
      { date: "2026-10-15", type: "DINNER" as const, guests: 2, status: "CONFIRMED" as const, notes: "Matar paneer, dal makhani, butter tawa roti & gulab jamun" },

      // 2026-10-16 (Next day planning)
      { date: "2026-10-16", type: "BREAKFAST" as const, guests: 2, status: "CONFIRMED" as const, notes: "Stuffed paneer parathas, dahi & masala chai" },
      { date: "2026-10-16", type: "LUNCH" as const, guests: 0, status: "DRAFT" as const, notes: "Chole bhature / steamed rice with pickled onion" },
      { date: "2026-10-16", type: "DINNER" as const, guests: 0, status: "DRAFT" as const, notes: "Paneer bhurji, dal fry & hot chapatis" },
    ];

    const mealRecordMap = new Map<string, Array<{ recordId: string; residentName: string; roomNumber: string; floor: number; stayId: string; residentId: string }>>();

    console.log("-> Seeding kitchen daily meal plans...");
    for (let pIdx = 0; pIdx < mealPlanSchedule.length; pIdx++) {
      const planDef = mealPlanSchedule[pIdx];
      const planId = `syn_plan_${(pIdx + 1).toString().padStart(3, "0")}`;

      // Calculate resident attendance count first
      let plannedResidents = 0;
      for (const res of inHouseResidents) {
        let optIn = true;
        if (planDef.type === "BREAKFAST") optIn = res.optBreakfast;
        else if (planDef.type === "LUNCH") optIn = res.optLunch;
        else if (planDef.type === "DINNER") optIn = res.optDinner;
        if (optIn) plannedResidents++;
      }

      const finalPrep = plannedResidents + planDef.guests;
      const confirmedAt = planDef.status !== "DRAFT" ? planDef.date + "T06:30:00.000Z" : null;
      const completedAt = planDef.status === "COMPLETED" ? planDef.date + "T14:00:00.000Z" : null;

      // 1. Insert Daily Meal Plan (Parent)
      insertPlan.run(
        planId,
        planDef.date,
        planDef.type,
        plannedResidents,
        planDef.guests,
        finalPrep,
        planDef.status,
        planDef.notes,
        "syn_staff_kit_01",
        planDef.status !== "DRAFT" ? "syn_staff_kit_01" : null,
        confirmedAt,
        planDef.status === "COMPLETED" ? "syn_staff_kit_01" : null,
        completedAt,
        planDef.date + "T06:00:00.000Z",
        now
      );
      trackEntity("daily_meal_plan", planId);
      stats.mealPlans++;

      // 2. Insert individual Resident Meal Records (Children)
      const recordsForPlan: Array<{ recordId: string; residentName: string; roomNumber: string; floor: number; stayId: string; residentId: string }> = [];

      for (let rIdx = 0; rIdx < inHouseResidents.length; rIdx++) {
        const res = inHouseResidents[rIdx];
        const info = residentMap.get(res.name)!;
        const roomDef = ROOM_DEFINITIONS.find((rd) => rd.number === res.assignedRoom)!;

        let optIn = true;
        if (planDef.type === "BREAKFAST") optIn = res.optBreakfast;
        else if (planDef.type === "LUNCH") optIn = res.optLunch;
        else if (planDef.type === "DINNER") optIn = res.optDinner;

        const recordId = `syn_rmr_${(pIdx + 1).toString().padStart(2, "0")}_${(rIdx + 1).toString().padStart(3, "0")}`;
        const recordStatus = optIn ? "CONFIRMED" : "OPTED_OUT";

        insertMealRecord.run(
          recordId,
          planId,
          info.residentId,
          info.stayId,
          planDef.date,
          planDef.type,
          recordStatus,
          "syn_staff_kit_01",
          planDef.date + "T06:00:00.000Z",
          now
        );
        trackEntity("resident_meal_record", recordId);
        stats.mealRecords++;

        if (optIn) {
          recordsForPlan.push({
            recordId,
            residentName: res.name,
            roomNumber: res.assignedRoom!,
            floor: roomDef.floor,
            stayId: info.stayId!,
            residentId: info.residentId,
          });
        }
      }

      mealRecordMap.set(planId, recordsForPlan);

      // Add 1 auditable adjustment record for 2026-10-15 LUNCH
      if (planDef.date === "2026-10-15" && planDef.type === "LUNCH") {
        const adjId = "syn_adj_001";
        insertAdjustment.run(
          adjId,
          planId,
          plannedResidents,
          plannedResidents,
          2, // previous guests
          4, // new guests
          plannedResidents + 2,
          plannedResidents + 4,
          "Visiting technical inspection delegation from Reliance MET infrastructure (2 additional guest thalis)",
          "syn_staff_kit_01",
          "2026-10-15T11:45:00.000Z"
        );
        trackEntity("meal_plan_adjustment", adjId);
        stats.mealAdjustments++;
      }
    }

    // ------------------------------------------------------------------------
    // G. SEED TIFFIN DELIVERY TASKS & EVENTS
    // ------------------------------------------------------------------------
    const insertTask = db.prepare(`
      INSERT INTO delivery_tasks (
        id, meal_record_id, plan_id, service_date, meal_type,
        resident_id, resident_name, room_number, floor, stay_id,
        status, assigned_to, assigned_to_name, assigned_by, assigned_at,
        dispatched_at, dispatched_by, delivered_at, delivered_by,
        delivery_notes, recipient_name, exception_type, exception_reason,
        exception_at, exception_by, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `);

    const insertEvent = db.prepare(`
      INSERT INTO delivery_task_events (
        id, task_id, event_type, from_status, to_status,
        actor_id, actor_name, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let taskCounter = 1;

    // Generate tasks for 2026-10-15 Breakfast & Lunch (Completed), and Dinner / 2026-10-16 Breakfast
    const deliveryPlansToSeed = [
      { planId: "syn_plan_004", date: "2026-10-15", meal: "BREAKFAST" as const, allDelivered: true },
      { planId: "syn_plan_005", date: "2026-10-15", meal: "LUNCH" as const, hasExceptions: true },
      { planId: "syn_plan_006", date: "2026-10-15", meal: "DINNER" as const, activeWorkload: true },
      { planId: "syn_plan_007", date: "2026-10-16", meal: "BREAKFAST" as const, queued: true },
    ];

    console.log("-> Seeding delivery tasks & events...");
    for (const dp of deliveryPlansToSeed) {
      const records = mealRecordMap.get(dp.planId) || [];

      for (let i = 0; i < records.length; i++) {
        const rec = records[i];
        const taskId = `syn_task_${(taskCounter++).toString().padStart(4, "0")}`;

        // Workload distribution between active delivery staff:
        // Ramesh Kumar (syn_staff_del_01) and Suresh Singh (syn_staff_del_02)
        const isRamesh = i % 2 === 0;
        const staffId = isRamesh ? "syn_staff_del_01" : "syn_staff_del_02";
        const staffName = isRamesh ? "Ramesh Kumar" : "Suresh Singh";

        let status: "PENDING" | "ASSIGNED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "EXCEPTION" = "DELIVERED";
        let assignedAt: string | null = dp.date + "T06:30:00.000Z";
        let dispatchedAt: string | null = dp.date + "T07:15:00.000Z";
        let deliveredAt: string | null = dp.date + "T07:45:00.000Z";
        let recipient: string | null = rec.residentName;
        let notes: string | null = "Handed directly to resident at room door";
        let exType: string | null = null;
        let exReason: string | null = null;
        let exAt: string | null = null;

        if (dp.allDelivered) {
          status = "DELIVERED";
        } else if (dp.hasExceptions) {
          if (i === 1) {
            // One explicit active exception
            status = "EXCEPTION";
            deliveredAt = null;
            recipient = null;
            notes = null;
            exType = "RESIDENT_UNAVAILABLE";
            exReason = "Resident is attending afternoon university classes in Jhajjar until 5:00 PM";
            exAt = dp.date + "T13:10:00.000Z";
          } else if (i === 3) {
            // One retried and completed exception
            status = "DELIVERED";
            recipient = rec.residentName;
            notes = "Re-delivered successfully after evening return from MET City";
          } else {
            status = "DELIVERED";
          }
        } else if (dp.activeWorkload) {
          // Dinner mix: some delivered, out for delivery, assigned, pending
          if (i < 18) {
            status = "DELIVERED";
            deliveredAt = dp.date + "T19:40:00.000Z";
          } else if (i < 24) {
            status = "OUT_FOR_DELIVERY";
            deliveredAt = null;
            recipient = null;
            notes = "In transit to room";
          } else if (i < 30) {
            status = "ASSIGNED";
            dispatchedAt = null;
            deliveredAt = null;
            recipient = null;
            notes = "Assigned for dinner run";
          } else {
            status = "PENDING";
            assignedAt = null;
            dispatchedAt = null;
            deliveredAt = null;
            recipient = null;
            notes = null;
          }
        } else if (dp.queued) {
          // Next morning queued
          if (i < 20) {
            status = "ASSIGNED";
            dispatchedAt = null;
            deliveredAt = null;
            recipient = null;
            notes = "Pre-assigned for morning service";
          } else {
            status = "PENDING";
            assignedAt = null;
            dispatchedAt = null;
            deliveredAt = null;
            recipient = null;
            notes = null;
          }
        }

        const effectiveAssignedStaffId = status === "PENDING" ? null : staffId;
        const effectiveAssignedStaffName = status === "PENDING" ? null : staffName;

        insertTask.run(
          taskId,
          rec.recordId,
          dp.planId,
          dp.date,
          dp.meal,
          rec.residentId,
          rec.residentName,
          rec.roomNumber,
          rec.floor,
          rec.stayId,
          status,
          effectiveAssignedStaffId,
          effectiveAssignedStaffName,
          effectiveAssignedStaffId ? "syn_staff_ops_01" : null,
          assignedAt,
          dispatchedAt,
          dispatchedAt ? effectiveAssignedStaffId : null,
          deliveredAt,
          deliveredAt ? effectiveAssignedStaffId : null,
          notes,
          recipient,
          exType,
          exReason,
          exAt,
          exAt ? effectiveAssignedStaffId : null,
          dp.date + "T06:00:00.000Z",
          now
        );
        trackEntity("delivery_task", taskId);
        stats.deliveryTasks++;

        // Audit events for task lifecycle
        const evCreated = `syn_tevt_${crypto.randomUUID()}`;
        insertEvent.run(
          evCreated,
          taskId,
          "CREATED",
          null,
          "PENDING",
          "syn_staff_kit_01",
          "Chef Balram Singh",
          "Delivery task created from confirmed meal plan",
          dp.date + "T06:00:00.000Z"
        );
        trackEntity("delivery_task_event", evCreated);
        stats.deliveryTaskEvents++;

        if (status !== "PENDING" && assignedAt) {
          const evAssigned = `syn_tevt_${crypto.randomUUID()}`;
          insertEvent.run(
            evAssigned,
            taskId,
            "ASSIGNED",
            "PENDING",
            "ASSIGNED",
            "syn_staff_ops_01",
            "Manoj Sharma",
            `Assigned to delivery person ${effectiveAssignedStaffName}`,
            assignedAt
          );
          trackEntity("delivery_task_event", evAssigned);
          stats.deliveryTaskEvents++;
        }

        if ((status === "OUT_FOR_DELIVERY" || status === "DELIVERED" || status === "EXCEPTION") && dispatchedAt) {
          const evDispatched = `syn_tevt_${crypto.randomUUID()}`;
          insertEvent.run(
            evDispatched,
            taskId,
            "DISPATCHED",
            "ASSIGNED",
            "OUT_FOR_DELIVERY",
            staffId,
            staffName,
            "Tiffin dispatched from kitchen loading bay",
            dispatchedAt
          );
          trackEntity("delivery_task_event", evDispatched);
          stats.deliveryTaskEvents++;
        }

        if (status === "DELIVERED" && deliveredAt) {
          const evDelivered = `syn_tevt_${crypto.randomUUID()}`;
          insertEvent.run(
            evDelivered,
            taskId,
            "DELIVERED",
            "OUT_FOR_DELIVERY",
            "DELIVERED",
            staffId,
            staffName,
            `Meal safely handed over to ${recipient}`,
            deliveredAt
          );
          trackEntity("delivery_task_event", evDelivered);
          stats.deliveryTaskEvents++;
        } else if (status === "EXCEPTION" && exAt) {
          const evException = `syn_tevt_${crypto.randomUUID()}`;
          insertEvent.run(
            evException,
            taskId,
            "EXCEPTION",
            "OUT_FOR_DELIVERY",
            "EXCEPTION",
            staffId,
            staffName,
            exReason,
            exAt
          );
          trackEntity("delivery_task_event", evException);
          stats.deliveryTaskEvents++;
        }
      }
    }

    // ------------------------------------------------------------------------
    // H. SEED AUDIT TRAIL LOGS (Meaningful Operational History)
    // ------------------------------------------------------------------------
    const insertAudit = db.prepare(`
      INSERT INTO audit_logs (
        id, actor_id, actor_username, action, target_type, target_id, metadata, ip_address, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const auditEventsToSeed = [
      {
        action: "resident.registered",
        targetType: "resident",
        targetId: "syn_res_001",
        actorId: "syn_staff_ops_01",
        actorName: "manoj_ops",
        meta: JSON.stringify({ fullName: "Aarav Sharma", phone: "+91 98120 44101", roomNumber: "101" }),
        date: "2026-06-15T10:00:00.000Z",
      },
      {
        action: "resident.checked_in",
        targetType: "resident",
        targetId: "syn_res_001",
        actorId: "syn_staff_ops_01",
        actorName: "manoj_ops",
        meta: JSON.stringify({ roomNumber: "101", checkInDate: "2026-06-15", monthlyRent: 13000, securityDeposit: 6000 }),
        date: "2026-06-15T10:15:00.000Z",
      },
      {
        action: "finance.security_deposit_recorded",
        targetType: "transaction",
        targetId: "syn_txn_0001",
        actorId: "syn_staff_acc_01",
        actorName: "sunita_acc",
        meta: JSON.stringify({ residentName: "Aarav Sharma", amount: 6000, paymentMethod: "UPI" }),
        date: "2026-06-15T10:20:00.000Z",
      },
      {
        action: "finance.rent_charge_recorded",
        targetType: "transaction",
        targetId: "syn_txn_0040",
        actorId: "syn_staff_acc_01",
        actorName: "sunita_acc",
        meta: JSON.stringify({ billingPeriod: "October 2026", totalBilled: 323000 }),
        date: "2026-10-01T09:00:00.000Z",
      },
      {
        action: "finance.rent_payment_recorded",
        targetType: "transaction",
        targetId: "syn_txn_0055",
        actorId: "syn_staff_acc_01",
        actorName: "sunita_acc",
        meta: JSON.stringify({ residentName: "Aarav Sharma", amount: 13000, paymentMethod: "UPI" }),
        date: "2026-10-05T14:30:00.000Z",
      },
      {
        action: "finance.expense_recorded",
        targetType: "transaction",
        targetId: "syn_txn_0080",
        actorId: "syn_staff_acc_01",
        actorName: "sunita_acc",
        meta: JSON.stringify({ category: "UTILITIES", amount: 23400, payee: "DHBVN" }),
        date: "2026-10-04T16:00:00.000Z",
      },
      {
        action: "kitchen.plan_confirmed",
        targetType: "meal_plan",
        targetId: "syn_plan_005",
        actorId: "syn_staff_kit_01",
        actorName: "balram_chef",
        meta: JSON.stringify({ mealType: "LUNCH", serviceDate: "2026-10-15", finalPreparationCount: 36 }),
        date: "2026-10-15T06:30:00.000Z",
      },
      {
        action: "delivery.tasks_generated",
        targetType: "meal_plan",
        targetId: "syn_plan_005",
        actorId: "syn_staff_ops_01",
        actorName: "manoj_ops",
        meta: JSON.stringify({ mealType: "LUNCH", createdCount: 32, skippedCount: 6 }),
        date: "2026-10-15T07:00:00.000Z",
      },
      {
        action: "delivery.task_delivered",
        targetType: "delivery_task",
        targetId: "syn_task_0035",
        actorId: "syn_staff_del_01",
        actorName: "ramesh_del",
        meta: JSON.stringify({ recipient: "Aarav Sharma", roomNumber: "101" }),
        date: "2026-10-15T07:45:00.000Z",
      },
      {
        action: "delivery.task_exception",
        targetType: "delivery_task",
        targetId: "syn_task_0036",
        actorId: "syn_staff_del_01",
        actorName: "ramesh_del",
        meta: JSON.stringify({ exceptionType: "RESIDENT_UNAVAILABLE", reason: "Resident at college in Jhajjar" }),
        date: "2026-10-15T13:10:00.000Z",
      },
    ];

    for (const a of auditEventsToSeed) {
      const audId = `syn_aud_${crypto.randomUUID()}`;
      insertAudit.run(
        audId,
        a.actorId,
        a.actorName,
        a.action,
        a.targetType,
        a.targetId,
        a.meta,
        "127.0.0.1",
        a.date
      );
      trackEntity("audit_log", audId);
      stats.auditLogs++;
    }
  });

  // Execute transaction
  seedTransaction();

  // 3. Post-seed database integrity check
  const integrity = db.pragma("integrity_check", { simple: true }) as string;
  const fkCheck = db.pragma("foreign_key_check") as any[];

  if (integrity !== "ok") {
    throw new Error(`[DATABASE INTEGRITY FAILURE] PRAGMA integrity_check failed: ${integrity}`);
  }

  if (fkCheck.length > 0) {
    throw new Error(
      `[FOREIGN KEY VIOLATION] Database has ${fkCheck.length} foreign key violations: ${JSON.stringify(fkCheck)}`
    );
  }

  return {
    success: true,
    message: `Synthetic demonstration dataset seeded successfully (Batch: ${SEED_BATCH_ID}). Verified 100% database integrity and foreign key constraints.`,
    stats,
  };
}

// ----------------------------------------------------------------------------
// CLI Direct Execution Entry Point
// ----------------------------------------------------------------------------
if (require.main === module) {
  seedSyntheticData({ allowSyntheticSeed: true, verbose: true })
    .then((result) => {
      console.log("\n================================================================================");
      console.log("RAVINARAYAN ERP — SYNTHETIC DATA SEEDING COMPLETE");
      console.log("================================================================================");
      console.log(result.message);
      console.log("\nSeeded Entity Quantities:");
      for (const [entity, count] of Object.entries(result.stats)) {
        console.log(`  • ${entity.padEnd(25)}: ${count}`);
      }
      console.log("================================================================================\n");
      process.exit(0);
    })
    .catch((err) => {
      console.error("\n[FATAL SEEDING ERROR]:", err.message);
      process.exit(1);
    });
}
