import { InMemoryDteRepository, type DteRepository } from "./dte-repository";
import { SupabaseDteRepository } from "./supabase-dte-repository";

export type DtePersistenceBackend = "memory" | "supabase";

const memoryRepository = new InMemoryDteRepository();

export function getDtePersistenceBackend(
  env: NodeJS.ProcessEnv = process.env,
): DtePersistenceBackend {
  return env.DTE_PERSISTENCE_BACKEND === "supabase" ? "supabase" : "memory";
}

export function getDteRepository(
  env: NodeJS.ProcessEnv = process.env,
): DteRepository {
  const backend = getDtePersistenceBackend(env);
  if (backend === "supabase") return new SupabaseDteRepository();
  return memoryRepository;
}
