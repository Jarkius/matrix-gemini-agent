/**
 * Morpheus Agent Pool
 *
 * Manages a pool of Morpheus agents for parallel research.
 * Follows "Haiku gathers, Opus synthesizes" pattern.
 */

import type {
  MorpheusAgent,
  MorpheusRole,
  AgentStatus,
  AgentPoolStats,
  ROLE_BEHAVIOR,
} from "../interfaces/agent";

export interface PoolConfig {
  maxAgents: number;
  maxPerRole: Record<MorpheusRole, number>;
}

const DEFAULT_CONFIG: PoolConfig = {
  maxAgents: 8,
  maxPerRole: {
    gatherer: 5,
    analyst: 2,
    synthesizer: 1,
  },
};

// Morpheus quotes for agent names
const MORPHEUS_NAMES = [
  "Morpheus-Alpha",
  "Morpheus-Beta",
  "Morpheus-Gamma",
  "Morpheus-Delta",
  "Morpheus-Epsilon",
  "Morpheus-Zeta",
  "Morpheus-Eta",
  "Morpheus-Theta",
];

export class MorpheusPool {
  private agents: Map<number, MorpheusAgent> = new Map();
  private nextId: number = 1;
  private config: PoolConfig;

  constructor(config?: Partial<PoolConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Spawn a new Morpheus agent with specified role
   */
  spawn(role: MorpheusRole): MorpheusAgent | null {
    // Check limits
    if (this.agents.size >= this.config.maxAgents) {
      console.error("[Pool] Max agents reached");
      return null;
    }

    const roleCount = this.countByRole(role);
    if (roleCount >= this.config.maxPerRole[role]) {
      console.error(`[Pool] Max ${role} agents reached (${roleCount})`);
      return null;
    }

    const id = this.nextId++;
    const name = MORPHEUS_NAMES[(id - 1) % MORPHEUS_NAMES.length];

    const agent: MorpheusAgent = {
      id,
      name: `${name}-${role.slice(0, 1).toUpperCase()}`,
      role,
      status: "idle",
      missionsCompleted: 0,
      missionsFailed: 0,
      createdAt: new Date(),
    };

    this.agents.set(id, agent);
    console.error(`[Pool] Spawned ${agent.name} (${role})`);

    return agent;
  }

  /**
   * Get an available agent for a role, spawning if needed
   */
  getAvailable(role: MorpheusRole): MorpheusAgent | null {
    // First, try to find an idle agent with matching role
    for (const agent of this.agents.values()) {
      if (agent.role === role && agent.status === "idle") {
        return agent;
      }
    }

    // No idle agent found, try to spawn one
    return this.spawn(role);
  }

  /**
   * Get multiple available agents for parallel work
   */
  getAvailableMultiple(role: MorpheusRole, count: number): MorpheusAgent[] {
    const agents: MorpheusAgent[] = [];

    for (let i = 0; i < count; i++) {
      const agent = this.getAvailable(role);
      if (agent) {
        agents.push(agent);
      } else {
        break; // Can't get more
      }
    }

    return agents;
  }

  /**
   * Assign a mission to an agent
   */
  assign(agentId: number, missionId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent || agent.status !== "idle") {
      return false;
    }

    agent.status = "busy";
    agent.currentMissionId = missionId;
    agent.lastActiveAt = new Date();

    return true;
  }

  /**
   * Release an agent after mission completion
   */
  release(agentId: number, success: boolean): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    if (success) {
      agent.missionsCompleted++;
    } else {
      agent.missionsFailed++;
    }

    agent.status = "idle";
    agent.currentMissionId = undefined;
    agent.lastActiveAt = new Date();
  }

  /**
   * Mark an agent as errored
   */
  markError(agentId: number): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = "error";
      agent.currentMissionId = undefined;
    }
  }

  /**
   * Terminate an agent
   */
  terminate(agentId: number): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    agent.status = "terminated";
    this.agents.delete(agentId);
    console.error(`[Pool] Terminated ${agent.name}`);

    return true;
  }

  /**
   * Get agent by ID
   */
  get(agentId: number): MorpheusAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all agents
   */
  getAll(): MorpheusAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Count agents by role
   */
  countByRole(role: MorpheusRole): number {
    let count = 0;
    for (const agent of this.agents.values()) {
      if (agent.role === role) count++;
    }
    return count;
  }

  /**
   * Get pool statistics
   */
  getStats(): AgentPoolStats {
    const stats: AgentPoolStats = {
      total: this.agents.size,
      idle: 0,
      busy: 0,
      byRole: {
        gatherer: 0,
        analyst: 0,
        synthesizer: 0,
      },
    };

    for (const agent of this.agents.values()) {
      if (agent.status === "idle") stats.idle++;
      if (agent.status === "busy") stats.busy++;
      stats.byRole[agent.role]++;
    }

    return stats;
  }

  /**
   * Drain pool - terminate all agents
   */
  drain(): void {
    for (const agent of this.agents.values()) {
      agent.status = "terminated";
    }
    this.agents.clear();
    console.error("[Pool] Drained all agents");
  }

  /**
   * Recover errored agents
   */
  recoverErrored(): number {
    let recovered = 0;
    for (const agent of this.agents.values()) {
      if (agent.status === "error") {
        agent.status = "idle";
        agent.currentMissionId = undefined;
        recovered++;
      }
    }
    return recovered;
  }
}
