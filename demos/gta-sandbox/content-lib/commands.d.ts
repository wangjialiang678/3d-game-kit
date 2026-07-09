import type { Issue } from './core';

export interface CommandSpec {
  params: string[];
  validateParams(params: any, content: any): Issue[];
  apply(content: any, params: any): void;
}

export const COMMANDS: Record<string, CommandSpec>;
export function validateAll(content: any): Issue[];
export function execute(content: any, cmdName: string, params?: any): Issue[];
