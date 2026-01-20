// 主入口
export { makeDecision, initEngine, getDecisionReason } from './engine';

// 类型导出
export type {
  CloakRequest,
  CloakDecision,
  CloakConfig,
  DetectionContext,
  DetectionDetails,
  DetectionLayer,
  Detector,
  DetectorResult,
  IPLookupResult,
  TrackingParams,
  L1Details,
  L2Details,
  L3Details,
  L4Details,
  L5Details,
} from './types';

// 检测器导出
export {
  l1Detector,
  l2Detector,
  l3Detector,
  l4Detector,
  l5Detector,
} from './detectors';

// 服务导出
export { getIPIntelligence, initMaxMind, closeMaxMind } from './services';

// 配置导出
export { defaultConfig, KNOWN_BOT_PATTERNS, SUSPICIOUS_UA_PATTERNS } from './config';
