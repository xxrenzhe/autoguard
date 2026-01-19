// 主入口
export { scrapePage, scrapePageSimple, type ScrapeConfig, type ScrapeResult, type AssetInfo } from './scraper/index.js';
export { generateSafePage, type SafePageType, type GenerateConfig, type GenerateResult } from './ai/index.js';
export {
  getPageDir,
  getPageHtmlPath,
  getAssetsDir,
  ensureDir,
  savePageHtml,
  readPageHtml,
  pageExists,
  deletePage,
  listSubdomains,
  getPageInfo,
  processHtmlAssetPaths,
  savePageWithProcessedPaths,
} from './storage/index.js';
