import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const place = z.string().trim().min(2).max(80);

export const flightSearchSchema = z
  .object({
    origin: place,
    destination: place,
    departureDate: date,
    returnDate: date.optional(),
    travelers: z.number().int().min(1).max(9),
    cabinClass: z.enum(["economy", "premium_economy", "business", "first"]).optional(),
    nonstop: z.boolean().optional(),
    departureTimeFrom: clock.optional(),
    departureTimeTo: clock.optional(),
    airline: z.string().trim().min(2).max(40).optional(),
  })
  .strict();

export const hotelSearchSchema = z
  .object({
    destination: place,
    checkIn: date,
    checkOut: date,
    guests: z.number().int().min(1).max(9),
    rooms: z.number().int().min(1).max(9).optional(),
  })
  .strict();

export const stayAreaSchema = z
  .object({
    place,
  })
  .strict();

const chatMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    text: z.string().trim().min(1).max(4000),
  })
  .strict();

export const chatRequestSchema = z
  .object({
    messages: z.array(chatMessageSchema).min(1).max(40),
    trip: z
      .object({
        destination: z.string().max(160).optional(),
        origin: z.string().max(160).optional(),
        startDate: z.string().max(32).optional(),
        endDate: z.string().max(32).optional(),
        budget: z.number().finite().nullable().optional(),
        members: z.array(z.string().max(80)).max(20).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type FlightSearchParams = z.infer<typeof flightSearchSchema>;
export type HotelSearchParams = z.infer<typeof hotelSearchSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export function flightDateError(input: FlightSearchParams): string | null {
  if (input.returnDate && input.returnDate <= input.departureDate) {
    return "Return date must be after the departure date.";
  }
  return null;
}

export function hotelDateError(input: HotelSearchParams): string | null {
  if (input.checkOut <= input.checkIn) return "Check-out must be after check-in.";
  return null;
}
