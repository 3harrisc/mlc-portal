"use server";

import { errorMessage, requireAdmin } from "@/lib/hr/server";
import { loadHrTodos } from "@/lib/hr/todos-server";
import type { HrTodo } from "@/lib/hr/todos";

export async function getHrTodos(): Promise<{ todos?: HrTodo[]; error?: string }> {
  try {
    await requireAdmin();
    return { todos: await loadHrTodos() };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
