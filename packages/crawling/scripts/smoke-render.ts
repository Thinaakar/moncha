import { closeRenderBrowser, renderPassToAuditResult, runRenderPass } from '../src/render-pass.ts';

async function main() {
  const r = await runRenderPass('https://example.com');
  const a = renderPassToAuditResult(r);
  console.log(
    JSON.stringify(
      {
        websiteStatus: a.websiteStatus,
        verdict: a.verdict,
        method: a.method,
        renderRan: a.renderRan,
        confidence: a.confidence,
        pagesVisited: r.pagesVisited,
        robotsAllowed: r.robotsAllowed,
        hasScreenshot: Boolean(r.screenshot?.length),
        renderComplete: r.renderComplete,
      },
      null,
      2,
    ),
  );
  await closeRenderBrowser();
}

main().catch(async (error) => {
  console.error(error);
  await closeRenderBrowser();
  process.exit(1);
});
