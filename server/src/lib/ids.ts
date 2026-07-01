import { customAlphabet } from "nanoid";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";

export const newId = customAlphabet(alphabet, 14);
export const newToken = customAlphabet(alphabet, 32);
