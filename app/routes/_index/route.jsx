import { redirect, Form, useLoaderData } from "react-router";
import { login, authenticate } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  // If inside Shopify Admin iframe or session exists, redirect with shop
  try {
    const { session } = await authenticate.admin(request);
    if (session?.shop) {
      const search = url.searchParams.toString();
      throw redirect(`/app${search ? `?${search}` : `?shop=${encodeURIComponent(session.shop)}`}`);
    }
  } catch (err) {
    if (err instanceof Response) throw err;
  }

  // Fallback redirect to /app so clicking the root app title in Shopify Admin opens Dashboard
  const search = url.searchParams.toString();
  throw redirect(`/app${search ? `?${search}` : ""}`);
};

export default function App() {
  const data = useLoaderData();
  const showForm = data?.showForm ?? Boolean(login);

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Process-list 물류 운영 시스템</h1>
        <p className={styles.text}>
          주문 검수, 납품서 발행, 재입고 관리 및 모바일 앱 운영 시스템입니다.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>스토어 도메인</span>
              <input
                className={styles.input}
                type="text"
                name="shop"
                placeholder="dawayo.myshopify.com"
              />
              <span>예: dawayo.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              로그인
            </button>
          </Form>
        )}
      </div>
    </div>
  );
}
