import { z } from "zod";
/** PostgreSQL may return UTC as +00:00; accept it as well as Z, never local offsets. */
export const utcInstantSchema=z.iso.datetime({offset:true}).refine(value=>value.endsWith("Z")||value.endsWith("+00:00"),"A UTC instant is required.");
