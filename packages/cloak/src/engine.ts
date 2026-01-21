/**
 * Cloak 检测引擎
 * 主入口，协调所有检测器进行决策
 */

import type {
  CloakRequest,
  CloakDecision,
  DetectionContext,
  DetectionDetails,
  CloakConfig,
} from './types';
import { l1Detector, l2Detector, l3Detector, l4Detector, l5Detector } from './detectors';
import { defaultConfig } from './config';
import { initMaxMind } from './services/ip-intelligence';

// 初始化标志
let engineInitialized = false;

/**
 * 初始化 Cloak 引擎
 */
export async function initEngine(): Promise<void> {
  if (engineInitialized) return;

  await initMaxMind();
  engineInitialized = true;
  console.log('Cloak engine initialized');
}

/**
 * 执行 Cloak 决策
 */
export async function makeDecision(
  request: CloakRequest,
  offerId: number,
  userId: number,
  options?: {
    targetCountries?: string[];
    cloakEnabled?: boolean;
    config?: Partial<CloakConfig>;
  }
): Promise<CloakDecision> {
  const startTime = Date.now();
  const override = options?.config;
  const config: CloakConfig = {
    ...defaultConfig,
    ...override,
    weights: { ...defaultConfig.weights, ...override?.weights },
    l2: { ...defaultConfig.l2, ...override?.l2 },
    l4: { ...defaultConfig.l4, ...override?.l4 },
    l5: { ...defaultConfig.l5, ...override?.l5 },
  };

  // 确保引擎已初始化
  if (!engineInitialized) {
    await initEngine();
  }

  const context: DetectionContext = {
    offerId,
    userId,
    targetCountries: options?.targetCountries,
    cloakEnabled: options?.cloakEnabled ?? true,
  };

  const details: DetectionDetails = {};
  let totalScore = 0;
  let blocked = false;
  let blockedAt: CloakDecision['blockedAt'];
  let blockedReason: string | undefined;

  try {
    // 创建超时 Promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('TIMEOUT')), config.decisionTimeoutMs);
    });

    // 执行检测（带超时）
    const detectionPromise = runDetection(request, context, config, details);

    const result = await Promise.race([detectionPromise, timeoutPromise]);

    totalScore = result.score;
    blocked = result.blocked;
    blockedAt = result.blockedAt;
    blockedReason = result.reason;
  } catch (error) {
    if (error instanceof Error && error.message === 'TIMEOUT') {
      // 超时，默认 Safe
      blocked = true;
      blockedAt = 'TIMEOUT';
      blockedReason = 'Decision timeout';
      totalScore = 0;
    } else {
      // 其他错误，默认 Safe
      console.error('Cloak decision error:', error);
      blocked = true;
      blockedReason = 'Internal error';
      totalScore = 0;
    }
  }

  const processingTime = Date.now() - startTime;

  // 最终决策
  const decision: CloakDecision['decision'] =
    blocked || totalScore < config.safeModeThreshold ? 'safe' : 'money';

  return {
    decision,
    score: totalScore,
    blockedAt: blocked ? blockedAt : undefined,
    reason: blockedReason,
    details,
    processingTime,
  };
}

/**
 * 运行所有检测层
 */
async function runDetection(
  request: CloakRequest,
  context: DetectionContext,
  config: CloakConfig,
  details: DetectionDetails
): Promise<{
  score: number;
  blocked: boolean;
  blockedAt?: CloakDecision['blockedAt'];
  reason?: string;
}> {
  const weights = config.weights;
  let totalScore = 0;
  let totalWeight = 0;

  // L1 - 静态黑名单（优先级最高，命中直接 Safe）
  const l1Result = await l1Detector.detect(request, context);
  details.l1 = l1Result.details as DetectionDetails['l1'];

  if (!l1Result.passed) {
    return {
      score: 0,
      blocked: true,
      blockedAt: 'L1',
      reason: l1Result.reason,
    };
  }
  totalScore += l1Result.score * weights.l1;
  totalWeight += weights.l1;

  // L2 - IP 情报
  if (weights.l2 > 0) {
    const l2Result = await l2Detector.detect(request, context);
    details.l2 = l2Result.details as DetectionDetails['l2'];

    if (!l2Result.passed && l2Result.score === 0) {
      return {
        score: 0,
        blocked: true,
        blockedAt: 'L2',
        reason: l2Result.reason,
      };
    }
    totalScore += l2Result.score * weights.l2;
    totalWeight += weights.l2;
  }

  // L3 - 地理位置
  if (weights.l3 > 0) {
    const l3Result = await l3Detector.detect(request, context);
    details.l3 = l3Result.details as DetectionDetails['l3'];

    if (!l3Result.passed && l3Result.score === 0) {
      return {
        score: 0,
        blocked: true,
        blockedAt: 'L3',
        reason: l3Result.reason,
      };
    }
    totalScore += l3Result.score * weights.l3;
    totalWeight += weights.l3;
  }

  // L4 - UA 检测
  if (weights.l4 > 0) {
    const l4Result = await l4Detector.detect(request, context);
    details.l4 = l4Result.details as DetectionDetails['l4'];

    if (!l4Result.passed && l4Result.score === 0) {
      return {
        score: 0,
        blocked: true,
        blockedAt: 'L4',
        reason: l4Result.reason,
      };
    }
    totalScore += l4Result.score * weights.l4;
    totalWeight += weights.l4;
  }

  // L5 - Referer/链接分析
  const l5Result = await l5Detector.detect(request, context);
  details.l5 = l5Result.details as DetectionDetails['l5'];

  // L5 默认不阻断，仅参与打分（同时用于提取 tracking params 写日志）
  if (weights.l5 > 0) {
    totalScore += l5Result.score * weights.l5;
    totalWeight += weights.l5;
  }

  // 计算加权平均分
  const finalScore = totalWeight > 0 ? Math.round(totalScore / totalWeight) : 0;

  return {
    score: finalScore,
    blocked: false,
  };
}

/**
 * 获取决策原因描述
 */
export function getDecisionReason(decision: CloakDecision): string {
  if (decision.blockedAt) {
    return `Blocked at ${decision.blockedAt}: ${decision.reason || 'Unknown'}`;
  }

  if (decision.decision === 'safe') {
    return `Low score (${decision.score}): ${decision.reason || 'Below threshold'}`;
  }

  return `Passed (${decision.score})`;
}
