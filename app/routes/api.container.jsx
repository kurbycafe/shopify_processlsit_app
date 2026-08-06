// CORS 허용을 위한 공통 헤더
// 실제 운영 환경에서는 "*" 대신 외부 앱의 실제 도메인을 지정하는 것이 안전합니다.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// 외부 앱에서 POST, PUT 등의 데이터를 보낼 때 처리하는 함수
export const action = async ({ request }) => {
  // CORS 사전 요청(Preflight) 처리
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (request.method === "POST") {
    try {
      // 외부 앱(모바일 앱 등)에서 전송한 JSON 데이터 파싱
      const data = await request.json();
      console.log("[API] 외부 앱으로부터 컨테이너 정보 수신:", data);
      
      // TODO: 여기서 DB(Prisma)에 저장하거나 필요한 비즈니스 로직을 수행하세요.
      // 예: await db.container.create({ data: { ... } })
      
      return Response.json(
        { success: true, message: "컨테이너 정보를 성공적으로 수신했습니다." },
        { headers: corsHeaders }
      );
    } catch (error) {
      console.error("[API] 컨테이너 정보 수신 중 오류 발생:", error);
      return Response.json(
        { success: false, error: "데이터 처리 중 오류가 발생했습니다." },
        { status: 500, headers: corsHeaders }
      );
    }
  }

  return Response.json(
    { success: false, error: "허용되지 않은 메서드입니다." },
    { status: 405, headers: corsHeaders }
  );
};

// 외부 앱에서 GET 요청으로 데이터를 조회할 때 처리하는 함수
export const loader = async ({ request }) => {
  // CORS 사전 요청(Preflight) 처리
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // 테스트용 응답 또는 컨테이너 목록 반환
  return Response.json(
    { success: true, message: "API 서버가 정상적으로 동작 중입니다." },
    { headers: corsHeaders }
  );
};
