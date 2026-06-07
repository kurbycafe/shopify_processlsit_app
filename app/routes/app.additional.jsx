import { useEffect } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  getEdgeConfigValue,
  isEdgeConfigEnabled,
  upsertEdgeConfigValue,
} from "../edge-config.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const edgeEnabled = isEdgeConfigEnabled();
  const sampleValue = await getEdgeConfigValue("shopify:sample", "(not set)");

  return {
    edgeEnabled,
    sampleValue,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  if (!isEdgeConfigEnabled()) {
    return {
      ok: false,
      message: "EDGE_CONFIG 환경변수가 없어 Edge Config를 사용할 수 없습니다.",
    };
  }

  const key = `shopify:shop:${session.shop}:lastSeenAt`;
  const value = new Date().toISOString();

  try {
    await upsertEdgeConfigValue(key, value);

    return {
      ok: true,
      key,
      value,
      message: "Edge Config에 값 저장 완료",
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Edge Config 저장 실패",
    };
  }
};

export default function AdditionalPage() {
  const { edgeEnabled, sampleValue } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  useEffect(() => {
    if (fetcher.data?.message) {
      shopify.toast.show(fetcher.data.message, {
        isError: !fetcher.data.ok,
      });
    }
  }, [fetcher.data, shopify]);

  return (
    <s-page heading="Additional page">
      <s-section heading="Multiple pages">
        <s-paragraph>
          The app template comes with an additional page which demonstrates how
          to create multiple pages within app navigation using{" "}
          <s-link
            href="https://shopify.dev/docs/apps/tools/app-bridge"
            target="_blank"
          >
            App Bridge
          </s-link>
          .
        </s-paragraph>
        <s-paragraph>
          To create your own page and have it show up in the app navigation, add
          a page inside <code>app/routes</code>, and a link to it in the{" "}
          <code>&lt;ui-nav-menu&gt;</code> component found in{" "}
          <code>app/routes/app.jsx</code>.
        </s-paragraph>

        <s-stack direction="block" gap="base">
          <s-paragraph>
            Edge Config 연결 상태: {edgeEnabled ? "활성화" : "비활성화"}
          </s-paragraph>
          <s-paragraph>샘플 키(shopify:sample): {String(sampleValue)}</s-paragraph>

          <fetcher.Form method="post">
            <s-button type="submit">현재 샵 타임스탬프 저장</s-button>
          </fetcher.Form>

          {fetcher.data?.key && (
            <s-paragraph>
              저장됨: {fetcher.data.key} = {fetcher.data.value}
            </s-paragraph>
          )}
        </s-stack>
      </s-section>
      <s-section slot="aside" heading="Resources">
        <s-unordered-list>
          <s-list-item>
            <s-link
              href="https://shopify.dev/docs/apps/design-guidelines/navigation#app-nav"
              target="_blank"
            >
              App nav best practices
            </s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}
