import clsx, { type ClassValue } from 'clsx';

/** Merge de clases condicionales (wrapper fino sobre clsx). */
export const cn = (...inputs: ClassValue[]) => clsx(inputs);
