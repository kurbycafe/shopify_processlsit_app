export const RECIPE_CATEGORIES = [
  { id: "ALL", labelKo: "전체 카테고리", labelDe: "Alle Kategorien", labelEn: "All Categories" },
  { id: "STREET_FOOD", labelKo: "길거리 음식 (Street Food)", labelDe: "Streetfood", labelEn: "Street Food" },
  { id: "MAIN_DISH", labelKo: "메인 요리 (Main Dish)", labelDe: "Hauptgerichte", labelEn: "Main Dish" },
  { id: "SOUP_STEW", labelKo: "국 & 찌개 (Soup & Stew)", labelDe: "Suppen & Eintöpfe", labelEn: "Soup & Stew" },
  { id: "RICE_NOODLES", labelKo: "밥 & 면류 (Rice & Noodles)", labelDe: "Reis & Nudeln", labelEn: "Rice & Noodles" },
  { id: "SIDE_DISH", labelKo: "반찬류 (Side Dish)", labelDe: "Beilagen (Banchan)", labelEn: "Side Dish" },
  { id: "DESSERT_SNACK", labelKo: "디저트 & 스낵 (Dessert & Snack)", labelDe: "Desserts & Snacks", labelEn: "Dessert & Snack" },
];

export const RECIPE_OCCASIONS = [
  { id: "ALL", labelKo: "전체 목적", labelDe: "Alle Anlässe", labelEn: "All Occasions" },
  { id: "QUICK_MEAL", labelKo: "10-15분 초간단 요리", labelDe: "Schnelle Gerichte (10-15 Min)", labelEn: "Quick Meal (10-15 Min)" },
  { id: "STUDENT_BUDGET", labelKo: "자취생 & 가성비 장보기", labelDe: "Studenten & Budget", labelEn: "Student & Budget" },
  { id: "FAMILY_MEAL", labelKo: "가족 식사 (2-4인분)", labelDe: "Familienessen (2-4 Pers.)", labelEn: "Family Meal (2-4 Servings)" },
  { id: "PARTY_BBQ", labelKo: "K-BBQ & 홈파티 세트", labelDe: "K-BBQ & Party", labelEn: "Party & Korean BBQ" },
  { id: "BEGINNER", labelKo: "유럽인을 위한 첫 한식 요리", labelDe: "K-Food Anfänger", labelEn: "Beginner Friendly" },
  { id: "SEASONAL", labelKo: "계절 특선 (여름/겨울/명절)", labelDe: "Saisonale Spezialitäten", labelEn: "Seasonal Special" },
];

export const DIETARY_OPTIONS = [
  { id: "VEGETARIAN", label: "Vegetarian", tone: "success" },
  { id: "VEGAN", label: "Vegan", tone: "success" },
  { id: "GLUTEN_FREE", label: "Gluten-Free", tone: "info" },
  { id: "HALAL_FRIENDLY", label: "Halal-Friendly", tone: "attention" },
  { id: "DAIRY_FREE", label: "Dairy-Free", tone: "info" },
];

export const SPICE_LEVELS = [
  { level: 0, labelKo: "0단계 (순한맛 / 안매움)", labelDe: "Stufe 0 (Nicht scharf)", labelEn: "Level 0 (Non-spicy)" },
  { level: 1, labelKo: "1단계 (약간 매콤)", labelDe: "Stufe 1 (Mild scharf)", labelEn: "Level 1 (Mild)" },
  { level: 2, labelKo: "2단계 (보통 매운맛 - 신라면 수준)", labelDe: "Stufe 2 (Mittel scharf)", labelEn: "Level 2 (Medium)" },
  { level: 3, labelKo: "3단계 (매운맛 - 불닭 초기 수준)", labelDe: "Stufe 3 (Sehr scharf)", labelEn: "Level 3 (Hot & Spicy)" },
  { level: 4, labelKo: "4단계 (극강의 매운맛)", labelDe: "Stufe 4 (Extrem scharf)", labelEn: "Level 4 (Extra Hot)" },
];

export const RECIPE_PRESETS = [
  {
    id: "tteokbokki",
    category: "STREET_FOOD",
    occasion: "QUICK_MEAL",
    difficulty: "EASY",
    prepTimeMinutes: 5,
    cookTimeMinutes: 15,
    baseServings: 2,
    spiceLevel: 3,
    dietaryFlags: ["VEGETARIAN"],
    imageUrl: "https://images.unsplash.com/photo-1627308595229-7830a5c91f9f?q=80&w=1000&auto=format&fit=crop",
    translations: {
      ko: {
        title: "매콤달콤 쫄깃한 한국 대표 길거리 간식, 떡볶이",
        subtitle: "15분 만에 완성하는 실패 없는 국민 분식 황금 레시피",
        introduction: "떡볶이는 한국의 가장 사랑받는 대표적인 길거리 음식입니다. 쫄깃쫄깃한 쌀떡과 매콤하면서도 달콤한 고추장 베이스 소스가 환상적인 조화를 이룹니다.",
        steps: [
          "떡볶이 떡(350g)을 찬물에 10분 정도 담가 불린 후 헹궈 건져냅니다.",
          "사각 어묵(2장)을 한입 크기로 썰고, 대파(1대)는 어슷썰기하여 준비합니다.",
          "냄비에 물 500ml를 붓고 고추장 2큰술, 고춧가루 1큰술, 양조간장 1큰술, 설탕 2큰술, 다진 마늘 1/2작은술을 풀어 끓입니다.",
          "양념장이 끓어오르면 떡을 넣고 중불에서 5분간 끓여 떡 속까지 양념이 배어들게 합니다.",
          "어묵과 대파를 추가하고 국물이 자작해질 때까지 5분 더 졸입니다.",
          "참기름 약간과 통깨를 뿌려 그릇에 담아냅니다."
        ]
      },
      de: {
        title: "Koreanische Reiskuchen in scharfer Sauce (Tteokbokki)",
        subtitle: "Koreas beliebtestes Streetfood - einfach & schnell in 15 Minuten",
        introduction: "Tteokbokki ist das ultimative koreanische Wohlfühlessen: Weiche, wunderbar zähe Reiskuchen geschmort in einer aromatischen, süß-scharfen Gochujang-Sauce.",
        steps: [
          "Reiskuchen (Tteok, 350g) für 10 Minuten in kaltem Wasser einweichen und abtropfen lassen.",
          "Fischkuchen (Eomuk, 2 Blatt) und Frühlingszwiebeln in mundgerechte Stücke schneiden.",
          "In einem Topf 500ml Wasser mit 2 EL Gochujang (Chilipaste), 1 EL Gochugaru (Chiliflocken), 1 EL Sojasauce, 2 EL Zucker und 1/2 TL Knoblauch aufkochen.",
          "Reiskuchen hineingeben und bei mittlerer Hitze ca. 5 Minuten köcheln lassen, bis sie weich werden.",
          "Fischkuchen und Frühlingszwiebeln dazugeben und weitere 5 Minuten einkochen, bis die Sauce dickflüssig ist.",
          "Mit etwas Sesamöl und gerösteten Sesamsamen garnieren und heiß servieren."
        ]
      },
      en: {
        title: "Korean Spicy & Sweet Rice Cakes (Tteokbokki)",
        subtitle: "Classic Korean Street Food in 15 Minutes",
        introduction: "Tteokbokki is Korea's most iconic street food, featuring chewy rice cakes cooked in a rich, spicy, and savory chili sauce.",
        steps: [
          "Soak rice cakes (350g) in cold water for 10 minutes, then drain.",
          "Cut fish cakes (2 sheets) and green onions into bite-sized pieces.",
          "In a shallow pan, bring 500ml water to a boil with 2 tbsp Gochujang, 1 tbsp Gochugaru, 1 tbsp soy sauce, 2 tbsp sugar, and 1/2 tsp minced garlic.",
          "Add rice cakes and cook on medium heat for 5 minutes until soft and chewy.",
          "Add fish cakes and green onions, simmering for another 5 minutes until the sauce thickens.",
          "Drizzle with sesame oil, sprinkle roasted sesame seeds, and enjoy."
        ]
      }
    },
    defaultIngredients: [
      { id: "ing_tteok", nameKo: "떡볶이 떡", nameDe: "Koreanische Reiskuchen (Tteok)", nameEn: "Korean Rice Cakes", amount: 350, unit: "g", type: "REQUIRED", searchKeywords: ["떡", "tteok", "rice cake", "jongga"], suggestedPackageQty: 1 },
      { id: "ing_gochujang", nameKo: "고추장", nameDe: "Chilipaste (Gochujang)", nameEn: "Red Chili Paste (Gochujang)", amount: 2, unit: "tbsp", type: "REQUIRED", searchKeywords: ["고추장", "gochujang", "chili paste", "sempio", "cj"], suggestedPackageQty: 1 },
      { id: "ing_gochugaru", nameKo: "고춧가루", nameDe: "Chiliflocken (Gochugaru)", nameEn: "Chili Powder (Gochugaru)", amount: 1, unit: "tbsp", type: "REQUIRED", searchKeywords: ["고춧가루", "gochugaru", "chili powder"], suggestedPackageQty: 1 },
      { id: "ing_eomuk", nameKo: "사각 어묵", nameDe: "Fischkuchen (Eomuk)", nameEn: "Fish Cakes (Eomuk)", amount: 2, unit: "sheets", type: "OPTIONAL", searchKeywords: ["어묵", "오뎅", "eomuk", "fish cake"], suggestedPackageQty: 1 },
      { id: "ing_sesame_oil", nameKo: "참기름", nameDe: "Geröstetes Sesamöl", nameEn: "Roasted Sesame Oil", amount: 1, unit: "tsp", type: "OPTIONAL", searchKeywords: ["참기름", "sesame oil", "ottogi"], suggestedPackageQty: 1 }
    ]
  },
  {
    id: "gimbap",
    category: "STREET_FOOD",
    occasion: "FAMILY_MEAL",
    difficulty: "MEDIUM",
    prepTimeMinutes: 20,
    cookTimeMinutes: 15,
    baseServings: 3,
    spiceLevel: 0,
    dietaryFlags: [],
    imageUrl: "https://images.unsplash.com/photo-1590301157890-4810ed352733?q=80&w=1000&auto=format&fit=crop",
    translations: {
      ko: {
        title: "고소하고 든든한 정통 야채 김밥",
        subtitle: "피크닉과 든든한 한 끼를 위한 정성 가득 김밥",
        introduction: "김밥은 고슬고슬하게 지은 밥에 참기름과 소금으로 밑간을 하고, 다양한 채소와 햄, 단무지 등을 김 위에 올려 돌돌 만 한국의 소풍 대표 음식입니다.",
        steps: [
          "따뜻한 밥 3공기에 참기름 1.5큰술, 소금 1/2작은술, 통깨 1큰술을 넣고 고루 섞어 식혀둡니다.",
          "당근은 채 썰어 팬에 기름을 두르고 소금을 약간 뿌려 볶고, 시금치는 데쳐 참기름과 소금에 무칩니다.",
          "김밥용 단무지, 우엉, 햄, 구운 계란 지단을 길게 썰어 준비합니다.",
          "김발 위에 김밥용 김의 거친 면이 위로 오도록 놓고, 양념한 밥을 2/3 지점까지 얇고 고르게 폅니다.",
          "준비한 속재료들을 가운데에 가지런히 올리고 김발을 이용해 단단하게 말아줍니다.",
          "김 겉면에 참기름을 살짝 바른 후 한입 크기(약 1.5cm)로 썰어 완성합니다."
        ]
      },
      de: {
        title: "Traditionelle Koreanische Seetang-Reisrollen (Gimbap)",
        subtitle: "Perfekt für Picknick, Lunchbox & gesunde Mahlzeiten",
        introduction: "Gimbap sind gerollte Reisrollen mit aromatisiertem Sesamreis und einer bunten Füllung aus knackigem Gemüse, Ei und Schinken.",
        steps: [
          "Gekochten Reis (3 Schalen) mit 1.5 EL Sesamöl, 1/2 TL Salz und Sesamsamen würzen und abkühlen lassen.",
          "Karottenstreifen kurz anbraten; Spinat blanchieren und mit Sesamöl und Salz abschmecken.",
          "Eingelegten Rettich (Danmuji), Klettenwurzel, Schinken und Eierstreifen bereitstellen.",
          "Gimbap-Seetangblatt (Gim) auf eine Bambusmatte legen und 2/3 der Fläche dünn mit Reis bedecken.",
          "Die Zutaten mittig auflegen und mit Hilfe der Matte fest einrollen.",
          "Die Rolle leicht mit Sesamöl bestreichen und in ca. 1.5 cm dicke Scheiben schneiden."
        ]
      },
      en: {
        title: "Authentic Korean Seaweed Rice Rolls (Gimbap)",
        subtitle: "Healthy and Delicious Packed Lunch Favorite",
        introduction: "Gimbap is a beloved Korean dish made from seasoned cooked rice rolled with various vegetables, egg, and ham in toasted seaweed sheets.",
        steps: [
          "Season 3 bowls of warm cooked rice with 1.5 tbsp sesame oil, 1/2 tsp salt, and 1 tbsp sesame seeds. Let cool.",
          "Sauté julienned carrots lightly with salt; blanch spinach and season with sesame oil and salt.",
          "Prepare yellow pickled radish, burdock root, ham strips, and egg omelet strips.",
          "Place a sheet of Gim (seaweed) rough side up on a bamboo mat, spreading rice evenly over 2/3 of the sheet.",
          "Arrange the filling ingredients across the center and roll tightly using the mat.",
          "Brush the outside with sesame oil and slice into 1.5cm bite-sized pieces."
        ]
      }
    },
    defaultIngredients: [
      { id: "ing_gim", nameKo: "김밥용 구운김", nameDe: "Gimbap-Seetangblätter (Gim)", nameEn: "Toasted Seaweed for Gimbap (Gim)", amount: 5, unit: "sheets", type: "REQUIRED", searchKeywords: ["김밥김", "gim", "seaweed", "nori", "badasori"], suggestedPackageQty: 1 },
      { id: "ing_danmuji", nameKo: "김밥용 단무지", nameDe: "Eingelegter Rettich (Danmuji)", nameEn: "Yellow Pickled Radish (Danmuji)", amount: 1, unit: "pack", type: "REQUIRED", searchKeywords: ["단무지", "danmuji", "pickled radish"], suggestedPackageQty: 1 },
      { id: "ing_rice", nameKo: "한국 쌀", nameDe: "Koreanischer Rundkornreis", nameEn: "Korean Short Grain Rice", amount: 400, unit: "g", type: "REQUIRED", searchKeywords: ["쌀", "rice", "korean rice", "shinode", "rhee chun"], suggestedPackageQty: 1 },
      { id: "ing_sesame_oil", nameKo: "참기름", nameDe: "Geröstetes Sesamöl", nameEn: "Roasted Sesame Oil", amount: 2, unit: "tbsp", type: "REQUIRED", searchKeywords: ["참기름", "sesame oil", "ottogi"], suggestedPackageQty: 1 },
      { id: "ing_burdock", nameKo: "김밥용 조림우엉", nameDe: "Klettenwurzel (Ueong)", nameEn: "Seasoned Burdock Root", amount: 1, unit: "pack", type: "OPTIONAL", searchKeywords: ["우엉", "burdock"], suggestedPackageQty: 1 }
    ]
  },
  {
    id: "hotteok",
    category: "STREET_FOOD",
    occasion: "DESSERT_SNACK",
    difficulty: "MEDIUM",
    prepTimeMinutes: 15,
    cookTimeMinutes: 10,
    baseServings: 4,
    spiceLevel: 0,
    dietaryFlags: ["VEGETARIAN"],
    imageUrl: "https://images.unsplash.com/photo-1544025162-d76694265947?q=80&w=1000&auto=format&fit=crop",
    translations: {
      ko: {
        title: "달콤한 꿀과 견과류가 가득한 길거리 찹쌀호떡",
        subtitle: "겨울철 손을 호호 불며 먹는 한국식 달콤 팬케이크",
        introduction: "호떡은 찹쌀 반죽 속에 흑설탕, 시나몬 파우더, 견과류를 듬뿍 넣고 기름에 노릇노릇하게 눌러 구워내는 한국의 대표적인 겨울 디저트입니다.",
        steps: [
          "미온수 180ml에 이스트 4g과 설탕 1작은술을 녹이고, 찹쌀호떡 믹스 분말(또는 밀가루+찹쌀가루)과 섞어 찰기 있게 반죽합니다.",
          "볼에 흑설탕 1/2컵, 계핏가루 1/2작은술, 다진 견과류(땅콩, 호두) 2큰술을 섞어 소를 만듭니다.",
          "손에 식용유를 바르고 반죽을 적당량 떼어 손바닥에 넓게 편 후 소를 1큰술 듬뿍 넣고 오므려 밀봉합니다.",
          "달군 팬에 식용유를 넉넉히 두르고 반죽의 오므린 면이 아래로 가도록 올려 약불에서 굽습니다.",
          "밑면이 노릇해지면 뒤집은 뒤 호떡 누르개나 뒤집개로 평평하게 꾹 눌러줍니다.",
          "앞뒤로 황금빛이 돌도록 2-3분간 노릇하게 구워 따뜻할 때 종이컵에 담아 드세요."
        ]
      },
      de: {
        title: "Koreanische Süße Pfannkuchen mit Zimt & Nüssen (Hotteok)",
        subtitle: "Koreas beliebtester warmer Winter-Dessert-Klassiker",
        introduction: "Hotteok sind knusprig gebratene Hefe-Pfannkuchen mit einer flüssigen, herrlich süßen Füllung aus braunem Zucker, Zimt und gehackten Nüssen.",
        steps: [
          "Hefeteig mit Hotteok-Backmischung und lauwarmem Wasser anrühren und kurz ruhen lassen.",
          "Braunen Rohrzucker, Zimtpulver und gehackte Erdnüsse/Walnüsse für die Füllung vermischen.",
          "Hände mit etwas Öl einreiben, eine Teigkugel formen, flach drücken und 1 EL der Füllung in die Mitte geben.",
          "Den Teig vorsichtig über der Füllung verschließen.",
          "In einer Pfanne mit reichlich Öl bei mittlerer Hitze anbraten, wenden und mit einem Pfannenwender flach drücken.",
          "Von beiden Seiten goldbraun und knusprig backen, bis der Zucker im Inneren geschmolzen ist."
        ]
      },
      en: {
        title: "Korean Sweet Cinnamon Pancakes (Hotteok)",
        subtitle: "Crispy Outside, Gooey Sweet Syrup Inside",
        introduction: "Hotteok is a popular Korean winter street food: chewy dough filled with brown sugar, cinnamon, and crushed nuts, pan-fried to golden perfection.",
        steps: [
          "Mix hotteok dough mix (or flour + glutinous rice flour) with warm water and yeast.",
          "Combine brown sugar, cinnamon powder, and chopped nuts for the filling.",
          "Oil hands, flatten a ball of dough, place 1 tbsp filling in center, and seal tightly.",
          "Place sealed side down in an oiled pan over medium-low heat.",
          "Flip once the bottom is golden, pressing down firmly with a spatula to flatten.",
          "Fry until both sides are golden brown and the sugar syrup is melted. Serve warm."
        ]
      }
    },
    defaultIngredients: [
      { id: "ing_hotteok_mix", nameKo: "백설 찹쌀호떡믹스", nameDe: "Hotteok Backmischung", nameEn: "Korean Hotteok Pancake Mix", amount: 1, unit: "box", type: "REQUIRED", searchKeywords: ["호떡", "hotteok", "cj hotteok", "baekseol"], suggestedPackageQty: 1 },
      { id: "ing_brown_sugar", nameKo: "흑설탕", nameDe: "Brauner Rohrzucker", nameEn: "Brown Sugar", amount: 100, unit: "g", type: "REQUIRED", searchKeywords: ["설탕", "sugar", "brown sugar"], suggestedPackageQty: 1 },
      { id: "ing_cinnamon", nameKo: "계핏가루", nameDe: "Zimtpulver", nameEn: "Cinnamon Powder", amount: 1, unit: "tsp", type: "OPTIONAL", searchKeywords: ["계피", "cinnamon"], suggestedPackageQty: 1 }
    ]
  },

  {
    id: "bulgogi",
    category: "MAIN_DISH",
    occasion: "PARTY_BBQ",
    difficulty: "EASY",
    prepTimeMinutes: 15,
    cookTimeMinutes: 10,
    baseServings: 3,
    spiceLevel: 0,
    dietaryFlags: [],
    imageUrl: "https://images.unsplash.com/photo-1544025162-d76694265947?q=80&w=1000&auto=format&fit=crop",
    translations: {
      ko: {
        title: "달콤 짭조름하고 부드러운 한국 정통 소고기 불고기",
        subtitle: "온 가족과 외국인 모두가 극찬하는 K-BBQ의 정석",
        introduction: "불고기는 소고기를 얇게 썰어 달콤 짭조름한 양념장에 재웠다가 야채와 함께 볶아내는 한국의 전통 육류 요리입니다.",
        steps: [
          "얇게 썬 소고기(400g)의 핏물을 키친타월로 가볍게 제거합니다.",
          "간장 4큰술, 설탕 2큰술, 맛술 2큰술, 다진 마늘 1큰술, 배즙(또는 간 사과) 3큰술, 참기름 1큰술, 후추 약간을 섞어 양념장을 만듭니다.",
          "소고기에 양념장을 버무리고 채 썬 양파, 당근, 대파, 버섯을 넣어 20분 이상 재워둡니다.",
          "달군 팬에 기름 없이 센 불로 고기와 야채를 빠르게 볶아 육즙을 보존합니다.",
          "고기가 부드럽게 익으면 불을 끄고 통깨를 뿌려 쌈 채소와 함께 냅니다."
        ]
      },
      de: {
        title: "Traditionelles Koreanisches Rindfleisch-BBQ (Bulgogi)",
        subtitle: "Zartes mariniertes Rindfleisch in süß-würziger Sojasauce",
        introduction: "Bulgogi ('Feuerfleisch') ist eines der bekanntesten koreanischen Gerichte: Hauchdünn geschnittenes Rindfleisch, eingelegt in einer süß-herzhaften Marinade.",
        steps: [
          "Dünn geschnittenes Rindfleisch (400g) trocken tupfen.",
          "Marinade aus 4 EL Sojasauce, 2 EL Zucker, 2 EL Mirin, 1 EL Knoblauch, 3 EL Birnensaft, 1 EL Sesamöl und Pfeffer anrühren.",
          "Fleisch mit Zwiebelstreifen, Karotten und Frühlingszwiebeln für mindestens 20 Minuten marinieren.",
          "In einer sehr heißen Pfanne oder auf dem Grill scharf anbraten.",
          "Mit geröstetem Sesam bestreuen und zusammen mit Reis und Salatblättern servieren."
        ]
      },
      en: {
        title: "Authentic Korean Beef BBQ (Bulgogi)",
        subtitle: "Sweet, Savory, and Tender Marinated Beef",
        introduction: "Bulgogi is Korea's classic marinated beef dish, loved worldwide for its tender texture and rich, balanced sweet and savory flavors.",
        steps: [
          "Pat thin beef slices (400g) dry with paper towels.",
          "Whisk soy sauce (4 tbsp), sugar (2 tbsp), mirin (2 tbsp), minced garlic (1 tbsp), pear puree (3 tbsp), sesame oil (1 tbsp), and pepper.",
          "Combine beef and marinade with sliced onion, carrots, and scallions. Marinate for 20 minutes.",
          "Stir-fry in a hot skillet over high heat until browned and juicy.",
          "Garnish with sesame seeds and serve with rice and lettuce wraps."
        ]
      }
    },
    defaultIngredients: [
      { id: "ing_bulgogi_sauce", nameKo: "소불고기 양념장", nameDe: "Bulgogi Marinade (Fertigsauce)", nameEn: "Korean Bulgogi Marinade", amount: 1, unit: "bottle", type: "REQUIRED", searchKeywords: ["불고기양념", "bulgogi sauce", "cj bulgogi", "sempio"], suggestedPackageQty: 1 },
      { id: "ing_soy_sauce", nameKo: "양조간장", nameDe: "Koreanische Sojasauce", nameEn: "Korean Soy Sauce", amount: 4, unit: "tbsp", type: "REQUIRED", searchKeywords: ["간장", "soy sauce", "sempio", "jin soy sauce"], suggestedPackageQty: 1 },
      { id: "ing_sesame_oil", nameKo: "참기름", nameDe: "Geröstetes Sesamöl", nameEn: "Roasted Sesame Oil", amount: 1, unit: "tbsp", type: "REQUIRED", searchKeywords: ["참기름", "sesame oil", "ottogi"], suggestedPackageQty: 1 },
      { id: "ing_sesame_seeds", nameKo: "볶음참깨", nameDe: "Geröstete Sesamsamen", nameEn: "Toasted Sesame Seeds", amount: 1, unit: "tsp", type: "OPTIONAL", searchKeywords: ["참깨", "sesame seeds"], suggestedPackageQty: 1 }
    ]
  },
  {
    id: "dakgalbi",
    category: "MAIN_DISH",
    occasion: "PARTY_BBQ",
    difficulty: "MEDIUM",
    prepTimeMinutes: 15,
    cookTimeMinutes: 15,
    baseServings: 3,
    spiceLevel: 3,
    dietaryFlags: [],
    imageUrl: "https://images.unsplash.com/photo-1544025162-d76694265947?q=80&w=1000&auto=format&fit=crop",
    translations: {
      ko: {
        title: "매콤한 춘천식 닭갈비와 볶음밥",
        subtitle: "양배추와 떡, 치즈를 듬뿍 넣은 매콤한 철판 닭요리",
        introduction: "춘천 닭갈비는 닭다리살을 매콤한 특제 고추장 양념에 재워 양배추, 고구마, 떡과 함께 철판에 볶아먹는 한국의 대표 외식 메뉴입니다.",
        steps: [
          "한입 크기로 썬 닭다리살(400g)에 고추장 2큰술, 고춧가루 2큰술, 간장 2큰술, 설탕 1.5큰술, 다진 마늘 1.5큰술, 카레가루 1/2작은술, 맛술 2큰술로 양념합니다.",
          "양배추 1/4통, 고구마 1/2개, 대파 1대, 떡볶이 떡 100g을 큼직하게 썹니다.",
          "넓은 팬에 기름을 두르고 닭고기와 고구마, 양배추, 떡을 모두 넣고 중강불에서 볶습니다.",
          "양배추 숨이 죽고 닭고기가 익을 때까지 약 10분간 저어가며 익힙니다.",
          "기호에 따라 모짜렐라 치즈를 가운데 녹여 퐁듀처럼 찍어 드시고, 남은 양념에 밥과 김가루를 넣어 볶음밥을 만듭니다."
        ]
      },
      de: {
        title: "Scharf Gebratenes Hähnchen mit Gemüse (Dakgalbi)",
        subtitle: "Koreas berühmtes Pfannengericht aus Chuncheon mit Reiskuchen & Kohl",
        introduction: "Dakgalbi ist ein pikantes Hähnchengericht aus zarter Hähnchenkeule, mariniert in einer feurigen Gochujang-Curry-Sauce, gebraten mit Weißkohl und Reiskuchen.",
        steps: [
          "Hähnchenfleisch (400g) in Würfel schneiden und mit 2 EL Gochujang, 2 EL Chiliflocken, 2 EL Sojasauce, 1.5 EL Zucker, Knoblauch und 1/2 TL Currypulver marinieren.",
          "Weißkohl, Süßkartoffel, Frühlingszwiebeln und Reiskuchen mundgerecht schneiden.",
          "In einer großen Pfanne mit etwas Öl das Fleisch und Gemüse bei mittlerer bis hoher Hitze anbraten.",
          "Ca. 10 Minuten rühren, bis das Fleisch durch und das Gemüse bissfest ist.",
          "Optional mit geschmolzenem Mozzarella-Käse servieren und zum Schluss Reis in die restliche Sauce rühren."
        ]
      },
      en: {
        title: "Spicy Stir-Fried Korean Chicken (Dakgalbi)",
        subtitle: "Famous Chuncheon-Style Chicken with Rice Cakes and Cabbage",
        introduction: "Dakgalbi features tender chicken thigh pieces marinated in a fiery gochujang-based sauce, stir-fried with crunchy cabbage, sweet potatoes, and chewy rice cakes.",
        steps: [
          "Cut boneless chicken thighs (400g) and marinate with 2 tbsp Gochujang, 2 tbsp Gochugaru, 2 tbsp soy sauce, 1.5 tbsp sugar, garlic, and a pinch of curry powder.",
          "Chop cabbage, sweet potato, scallions, and prepare rice cakes.",
          "Heat oil in a large skillet, adding the marinated chicken and vegetables.",
          "Stir-fry over medium-high heat for 10-12 minutes until chicken is cooked through.",
          "Top with melted mozzarella cheese or finish by making stir-fried rice with leftover sauce."
        ]
      }
    },
    defaultIngredients: [
      { id: "ing_gochujang", nameKo: "고추장", nameDe: "Chilipaste (Gochujang)", nameEn: "Red Chili Paste (Gochujang)", amount: 2, unit: "tbsp", type: "REQUIRED", searchKeywords: ["고추장", "gochujang", "sempio"], suggestedPackageQty: 1 },
      { id: "ing_gochugaru", nameKo: "고춧가루", nameDe: "Chiliflocken (Gochugaru)", nameEn: "Chili Powder (Gochugaru)", amount: 2, unit: "tbsp", type: "REQUIRED", searchKeywords: ["고춧가루", "gochugaru"], suggestedPackageQty: 1 },
      { id: "ing_tteok", nameKo: "떡볶이 떡", nameDe: "Koreanische Reiskuchen", nameEn: "Rice Cakes", amount: 150, unit: "g", type: "OPTIONAL", searchKeywords: ["떡", "tteok", "rice cake"], suggestedPackageQty: 1 },
      { id: "ing_curry", nameKo: "오뚜기 카레가루", nameDe: "Koreanisches Currypulver", nameEn: "Korean Curry Powder", amount: 1, unit: "tsp", type: "OPTIONAL", searchKeywords: ["카레", "curry", "ottogi curry"], suggestedPackageQty: 1 }
    ]
  },
  {
    id: "japchae",
    category: "MAIN_DISH",
    occasion: "FAMILY_MEAL",
    difficulty: "MEDIUM",
    prepTimeMinutes: 20,
    cookTimeMinutes: 15,
    baseServings: 4,
    spiceLevel: 0,
    dietaryFlags: ["VEGETARIAN"],
    imageUrl: "https://images.unsplash.com/photo-1590301157890-4810ed352733?q=80&w=1000&auto=format&fit=crop",
    translations: {
      ko: {
        title: "탱글탱글한 당면과 오색 야채 잡채",
        subtitle: "생일상과 명절에 빠질 수 없는 잔치 요리의 주인공",
        introduction: "잡채는 고구마 전분으로 만든 쫄깃한 당면에 소고기, 표고버섯, 시금치, 당근, 양파를 각각 볶아 간장과 참기름으로 버무려내는 고급 잔치 요리입니다.",
        steps: [
          "당면(200g)을 끓는 물에 7분간 삶은 뒤 찬물에 헹궈 체에 밭쳐두고, 먹기 좋게 가위로 자릅니다.",
          "시금치는 살짝 데쳐 소금과 참기름에 무치고, 당근, 양파, 목이버섯/표고버섯은 채 썰어 각각 소금을 치고 볶습니다.",
          "소고기는 간장, 설탕, 다진 마늘, 참기름으로 밑간하여 볶아둡니다.",
          "팬에 간장 4큰술, 설탕 2큰술, 식용유 2큰술, 물 3큰술을 넣고 끓어오르면 삶아둔 당면을 넣고 윤기가 돌 때까지 조립니다.",
          "넓은 볼에 조린 당면과 볶아둔 모든 야채 및 고기를 담고 참기름 2큰술과 통깨를 넣어 골고루 버무려 완성합니다."
        ]
      },
      de: {
        title: "Koreanische Süßkartoffel-Glasnudeln mit Gemüse (Japchae)",
        subtitle: "Glänzende, zarte Glasnudeln für festliche Anlässe",
        introduction: "Japchae ist eines der beliebtesten Festtagsgerichte Koreas: Elastische Süßkartoffel-Glasnudeln (Dangmyeon), harmonisch vermengt mit buntem Gemüse, Pilzen und geröstetem Sesamöl.",
        steps: [
          "Süßkartoffel-Glasnudeln (200g) für 7 Minuten kochen, kalt abschrecken und mit der Schere kürzen.",
          "Spinat blanchieren; Karotten, Zwiebeln und Shiitake-Pilze in Streifen schneiden und separat anbraten.",
          "In einer Pfanne 4 EL Sojasauce, 2 EL Zucker, 2 EL Öl und etwas Wasser aufkochen, die Nudeln dazugeben und glänzend einkochen.",
          "Die glasierten Nudeln und das vorbereitete Gemüse in einer großen Schüssel zusammenfügen.",
          "Mit 2 EL geröstetem Sesamöl und Sesamsamen gründlich vermengen und lauwarm servieren."
        ]
      },
      en: {
        title: "Korean Glass Noodles with Stir-Fried Vegetables (Japchae)",
        subtitle: "Bouncy Sweet Potato Glass Noodles with Colorful Veggies",
        introduction: "Japchae is a celebration favorite featuring sweet potato starch noodles (dangmyeon) tossed with sautéed spinach, carrots, mushrooms, and savory sesame soy dressing.",
        steps: [
          "Boil sweet potato noodles (200g) for 7 minutes, rinse in cold water, drain and cut with kitchen shears.",
          "Blanch spinach; stir-fry julienned carrots, onions, and mushrooms individually with a pinch of salt.",
          "In a pan, simmer 4 tbsp soy sauce, 2 tbsp sugar, and 2 tbsp oil. Add noodles and toss until translucent and glossy.",
          "Combine warm noodles and cooked vegetables in a large mixing bowl.",
          "Add 2 tbsp toasted sesame oil and sesame seeds, tossing well to combine."
        ]
      }
    },
    defaultIngredients: [
      { id: "ing_dangmyeon", nameKo: "옛날 당면 (고구마 전분)", nameDe: "Süßkartoffel-Glasnudeln (Dangmyeon)", nameEn: "Korean Sweet Potato Starch Noodles", amount: 200, unit: "g", type: "REQUIRED", searchKeywords: ["당면", "dangmyeon", "glass noodles", "ottogi dangmyeon"], suggestedPackageQty: 1 },
      { id: "ing_soy_sauce", nameKo: "진간장", nameDe: "Koreanische Sojasauce", nameEn: "Korean Soy Sauce", amount: 4, unit: "tbsp", type: "REQUIRED", searchKeywords: ["간장", "soy sauce", "sempio"], suggestedPackageQty: 1 },
      { id: "ing_sesame_oil", nameKo: "참기름", nameDe: "Geröstetes Sesamöl", nameEn: "Roasted Sesame Oil", amount: 2, unit: "tbsp", type: "REQUIRED", searchKeywords: ["참기름", "sesame oil", "ottogi"], suggestedPackageQty: 1 },
      { id: "ing_shiitake", nameKo: "말린 표고버섯", nameDe: "Getrocknete Shiitake-Pilze", nameEn: "Dried Shiitake Mushrooms", amount: 50, unit: "g", type: "OPTIONAL", searchKeywords: ["표고버섯", "shiitake", "mushroom"], suggestedPackageQty: 1 }
    ]
  },

  {
    id: "kimchijjigae",
    category: "SOUP_STEW",
    occasion: "STUDENT_BUDGET",
    difficulty: "EASY",
    prepTimeMinutes: 10,
    cookTimeMinutes: 20,
    baseServings: 2,
    spiceLevel: 2,
    dietaryFlags: [],
    imageUrl: "https://images.unsplash.com/photo-1627308595260-6fad84c1ec66?q=80&w=1000&auto=format&fit=crop",
    translations: {
      ko: {
        title: "얼큰하고 진한 국물 맛, 밥도둑 돼지고기 김치찌개",
        subtitle: "잘 익은 신김치와 부드러운 두부로 끓이는 한국인의 소울푸드",
        introduction: "김치찌개는 잘 익은 신김치와 돼지고기를 푹 끓여내 깊고 시원한 맛이 특징인 한국인의 밥상에서 빼놓을 수 없는 대표 찌개입니다.",
        steps: [
          "잘 익은 신김치(200g)를 먹기 좋은 크기로 썰고, 돼지고기 찌개용(150g)을 준비합니다.",
          "냄비에 참기름 1큰술을 두르고 돼지고기를 겉면이 하얗게 될 때까지 볶습니다.",
          "김치와 다진 마늘 1큰술, 고춧가루 1큰술을 넣고 김치가 나른해질 때까지 3-4분간 함께 볶습니다.",
          "물(또는 쌀뜨물/육수) 500ml를 붓고 센 불에서 끓이다가 끓어오르면 중불로 낮춰 15분 이상 푹 끓입니다.",
          "도톰하게 썬 두부 1/2모와 대파, 청양고추를 올리고 5분 더 끓여 완성합니다."
        ]
      },
      de: {
        title: "Herzhafter Kimchi-Eintopf mit Schweinefleisch & Tofu (Kimchi Jjigae)",
        subtitle: "Koreas ultimatives Wohlfühlessen - kräftig, wärmend & pikant",
        introduction: "Kimchi Jjigae ist der beliebteste Eintopf Koreas: Gut gereifter Kimchi gekocht mit zartem Fleisch und weichem Tofu zu einer aromatisch-tiefen Suppe.",
        steps: [
          "Gereiften Kimchi (200g) in mundgerechte Stücke schneiden; 150g Schweinefleisch vorbereiten.",
          "In einem Topf mit 1 EL Sesamöl das Fleisch anbraten, bis es die Farbe wechselt.",
          "Kimchi, 1 EL Knoblauch und 1 EL Chiliflocken dazugeben und ca. 3-4 Minuten anbraten.",
          "500ml Wasser oder Brühe angießen, aufkochen und bei mittlerer Hitze ca. 15 Minuten sanft köcheln lassen.",
          "Tofuscheiben und Frühlingszwiebeln hinzugeben und weitere 5 Minuten ziehen lassen."
        ]
      },
      en: {
        title: "Hearty Korean Kimchi Stew (Kimchi Jjigae)",
        subtitle: "Deep and Flavorful Comfort Stew with Pork and Tofu",
        introduction: "Kimchi Jjigae is Korea's ultimate comfort food, made with well-fermented kimchi, tender pork, and soft tofu simmered in a rich, savory broth.",
        steps: [
          "Chop well-fermented aged Kimchi (200g) and pork stew meat (150g).",
          "Heat 1 tbsp sesame oil in a pot and brown the pork over medium heat.",
          "Add kimchi, 1 tbsp minced garlic, and 1 tbsp chili powder, sautéing for 3-4 minutes until softened.",
          "Pour in 500ml water or broth, bring to a boil, then reduce heat and simmer for 15 minutes.",
          "Add sliced tofu and green onions, cooking for another 5 minutes before serving hot with rice."
        ]
      }
    },
    defaultIngredients: [
      { id: "ing_kimchi", nameKo: "종가집 맛김치 / 포기김치", nameDe: "Koreanischer Kimchi (Jongga)", nameEn: "Authentic Korean Kimchi", amount: 250, unit: "g", type: "REQUIRED", searchKeywords: ["김치", "kimchi", "jongga", "mat kimchi"], suggestedPackageQty: 1 },
      { id: "ing_tofu", nameKo: "부침/찌개용 두부", nameDe: "Frischer Tofu", nameEn: "Fresh Firm Tofu", amount: 1, unit: "pack", type: "REQUIRED", searchKeywords: ["두부", "tofu", "unsu tofu"], suggestedPackageQty: 1 },
      { id: "ing_gochugaru", nameKo: "고춧가루", nameDe: "Chiliflocken (Gochugaru)", nameEn: "Chili Powder (Gochugaru)", amount: 1, unit: "tbsp", type: "REQUIRED", searchKeywords: ["고춧가루", "gochugaru"], suggestedPackageQty: 1 },
      { id: "ing_sesame_oil", nameKo: "참기름", nameDe: "Geröstetes Sesamöl", nameEn: "Roasted Sesame Oil", amount: 1, unit: "tbsp", type: "REQUIRED", searchKeywords: ["참기름", "sesame oil"], suggestedPackageQty: 1 }
    ]
  },
  {
    id: "sundubujjigae",
    category: "SOUP_STEW",
    occasion: "QUICK_MEAL",
    difficulty: "EASY",
    prepTimeMinutes: 5,
    cookTimeMinutes: 12,
    baseServings: 2,
    spiceLevel: 3,
    dietaryFlags: ["VEGETARIAN"],
    imageUrl: "https://images.unsplash.com/photo-1544025162-d76694265947?q=80&w=1000&auto=format&fit=crop",
    translations: {
      ko: {
        title: "얼큰하고 부드러운 해물 순두부찌개",
        subtitle: "뚝배기에서 보글보글 끓여 계란 노른자를 톡 터뜨려 먹는 별미",
        introduction: "순두부찌개는 입안에서 사르르 녹는 부드러운 순두부와 매콤한 고추기름 베이스 국물이 어우러진 한국의 대표 뚝배기 요리입니다.",
        steps: [
          "냄비나 뚝배기에 식용유 1큰술과 참기름 1큰술을 두르고 다진 마늘 1큰술, 대파 1/2대를 볶아 향을 냅니다.",
          "불을 줄이고 고춧가루 1.5큰술을 넣어 타지 않게 볶아 즉석 고추기름을 만듭니다.",
          "물 또는 다시마 육수 300ml를 붓고 국간장 1큰술과 해물(조개, 새우 등)을 넣어 끓입니다.",
          "국물이 끓어오르면 순두부 1봉지를 숟가락으로 큼직하게 뚝뚝 떼어 넣습니다.",
          "중불에서 4-5분간 끓인 후 계란 1개를 가운데 깨뜨려 넣고 대파를 얹어 불을 끕니다."
        ]
      },
      de: {
        title: "Pikanter Seidentofu-Eintopf (Sundubu Jjigae)",
        subtitle: "Cremig-zarter Seidentofu in feuriger Chili-Brühe mit Ei",
        introduction: "Sundubu Jjigae ist ein berühmter koreanischer Eintopf mit ultra-zartem Seidentofu in einer aromatisch-scharfen Chili-Öl-Brühe.",
        steps: [
          "In einem Topf 1 EL Öl und 1 EL Sesamöl mit Knoblauch und Frühlingszwiebeln anbraten.",
          "Hitze reduzieren, 1.5 EL Chiliflocken dazugeben und vorsichtig zu einem Chili-Öl verrühren.",
          "300ml Wasser oder Brühe sowie 1 EL Sojasauce und Meeresfrüchte hinzufügen und aufkochen.",
          "Eine Packung Seidentofu (Sundubu) mit dem Löffel in groben Stücken hineingeben.",
          "Ca. 4 Minuten köcheln lassen, ein frisches Ei hineinschlagen und heiß servieren."
        ]
      },
      en: {
        title: "Spicy Korean Soft Tofu Stew (Sundubu Jjigae)",
        subtitle: "Silky Soft Tofu in a Sizzling Chili Oil Broth with Egg",
        introduction: "Sundubu Jjigae features silky uncurdled soft tofu stewed in a bold and fiery aromatic chili oil broth, typically topped with a fresh egg yolk.",
        steps: [
          "Heat 1 tbsp cooking oil and 1 tbsp sesame oil in a pot; sauté garlic and scallions.",
          "Lower heat, add 1.5 tbsp chili powder to create a rich chili oil without burning.",
          "Pour in 300ml water or broth with 1 tbsp soy sauce and seafood (optional), bringing to a boil.",
          "Scoop in 1 tube of soft tofu in large spoonfuls.",
          "Simmer for 4 minutes, crack an egg directly into the bubbling stew, and serve immediately."
        ]
      }
    },
    defaultIngredients: [
      { id: "ing_soft_tofu", nameKo: "순두부", nameDe: "Seidentofu (Sundubu)", nameEn: "Korean Soft Tofu (Sundubu)", amount: 1, unit: "tube", type: "REQUIRED", searchKeywords: ["순두부", "soft tofu", "silken tofu"], suggestedPackageQty: 1 },
      { id: "ing_sundubu_sauce", nameKo: "다담 순두부찌개 양념", nameDe: "Sundubu Jjigae Würzpaste (Dadam)", nameEn: "Korean Soft Tofu Stew Sauce", amount: 1, unit: "pack", type: "OPTIONAL", searchKeywords: ["순두부양념", "dadam", "cj dadam"], suggestedPackageQty: 1 },
      { id: "ing_gochugaru", nameKo: "고춧가루", nameDe: "Chiliflocken (Gochugaru)", nameEn: "Chili Powder (Gochugaru)", amount: 1, unit: "tbsp", type: "REQUIRED", searchKeywords: ["고춧가루", "gochugaru"], suggestedPackageQty: 1 },
      { id: "ing_sesame_oil", nameKo: "참기름", nameDe: "Geröstetes Sesamöl", nameEn: "Roasted Sesame Oil", amount: 1, unit: "tbsp", type: "REQUIRED", searchKeywords: ["참기름", "sesame oil"], suggestedPackageQty: 1 }
    ]
  },
  {
    id: "budaejjigae",
    category: "SOUP_STEW",
    occasion: "PARTY_BBQ",
    difficulty: "EASY",
    prepTimeMinutes: 10,
    cookTimeMinutes: 15,
    baseServings: 3,
    spiceLevel: 2,
    dietaryFlags: [],
    imageUrl: "https://images.unsplash.com/photo-1627308595260-6fad84c1ec66?q=80&w=1000&auto=format&fit=crop",
    translations: {
      ko: {
        title: "햄과 소시지, 라면사리가 가득한 의정부 부대찌개",
        subtitle: "치즈와 라면사리를 얹어 먹는 얼큰하고 푸짐한 전골",
        introduction: "부대찌개는 스팸, 소시지, 김치, 떡, 베이크드 빈스를 매콤한 양념장과 함께 끓여 라면사리와 치즈를 곁들여 먹는 한국만의 퓨전 전골 요리입니다.",
        steps: [
          "스팸 1/2캔과 프랑크 소시지 2개를 어슷 썰고, 김치 100g과 두부, 떡국 떡을 준비합니다.",
          "고추장 1큰술, 고춧가루 2큰술, 간장 1.5큰술, 다진 마늘 1큰술을 섞어 양념장을 만듭니다.",
          "넓은 전골냄비에 준비한 햄, 소시지, 김치, 두부, 떡, 베이크드 빈스를 보기 좋게 둘러 담고 가운데에 양념장을 올립니다.",
          "육수나 물 600ml를 붓고 센 불에서 보글보글 끓입니다.",
          "국물이 끓으면 라면사리와 체다 치즈 1장을 올리고 3분간 더 끓여 면이 꼬들꼬들할 때 함께 즐깁니다."
        ]
      },
      de: {
        title: "Koreanischer Army-Base-Eintopf mit Ramyeon (Budae Jjigae)",
        subtitle: "Herzhafter Schlemmer-Eintopf mit Schinken, Wurst, Käse & Nudeln",
        introduction: "Budae Jjigae ist ein berühmter Fusions-Eintopf mit würzigem Spam, Würstchen, Kimchi, Reiskuchen und Ramyeon-Nudeln in einer aromatischen Brühe mit geschmolzenem Käse.",
        steps: [
          "Spam (Dosenfleisch) und Würstchen in Scheiben schneiden; Kimchi, Tofu und Reiskuchen vorbereiten.",
          "Sauce aus 1 EL Gochujang, 2 EL Chiliflocken, 1.5 EL Sojasauce und 1 EL Knoblauch anrühren.",
          "Alle Zutaten dekorativ in einem flachen Topf anrichten und die Sauce in die Mitte setzen.",
          "600ml Brühe angießen und bei starker Hitze aufkochen.",
          "Ramyeon-Nudeln und eine Scheibe Cheddar-Käse auflegen, ca. 3 Minuten kochen und heiß löffeln."
        ]
      },
      en: {
        title: "Korean Army Base Stew with Ramyeon (Budae Jjigae)",
        subtitle: "Hearty and Comforting Fusion Hot Pot with Sausage, Spam, and Noodles",
        introduction: "Budae Jjigae is Korea's legendary fusion stew made with spam, sausage, kimchi, baked beans, and ramen noodles topped with melted cheddar cheese.",
        steps: [
          "Slice spam and sausages; chop kimchi and slice tofu and rice cake slices.",
          "Mix 1 tbsp Gochujang, 2 tbsp chili powder, 1.5 tbsp soy sauce, and 1 tbsp minced garlic.",
          "Arrange all ingredients in a wide shallow pan and add the sauce in the center.",
          "Pour in 600ml broth and bring to a rolling boil over high heat.",
          "Add instant ramyeon noodles and a slice of cheddar cheese. Cook for 3 minutes and enjoy."
        ]
      }
    },
    defaultIngredients: [
      { id: "ing_spam", nameKo: "스팸 클래식", nameDe: "Koreanischer Spam / Dosenfleisch", nameEn: "Spam Luncheon Meat", amount: 1, unit: "can", type: "REQUIRED", searchKeywords: ["스팸", "spam", "cj spam"], suggestedPackageQty: 1 },
      { id: "ing_ramyeon_sari", nameKo: "오뚜기 라면사리", nameDe: "Ramyeon Nudelsari", nameEn: "Plain Ramyeon Noodles", amount: 1, unit: "pack", type: "REQUIRED", searchKeywords: ["라면사리", "ramen noodles", "ottogi sari"], suggestedPackageQty: 1 },
      { id: "ing_kimchi", nameKo: "종가집 김치", nameDe: "Koreanischer Kimchi", nameEn: "Korean Kimchi", amount: 150, unit: "g", type: "REQUIRED", searchKeywords: ["김치", "kimchi"], suggestedPackageQty: 1 },
      { id: "ing_gochujang", nameKo: "고추장", nameDe: "Chilipaste (Gochujang)", nameEn: "Red Chili Paste", amount: 1, unit: "tbsp", type: "REQUIRED", searchKeywords: ["고추장", "gochujang"], suggestedPackageQty: 1 }
    ]
  },

  {
    id: "bibimbap",
    category: "RICE_NOODLES",
    occasion: "BEGINNER",
    difficulty: "EASY",
    prepTimeMinutes: 15,
    cookTimeMinutes: 10,
    baseServings: 2,
    spiceLevel: 1,
    dietaryFlags: ["VEGETARIAN", "VEGAN"],
    imageUrl: "https://images.unsplash.com/photo-1590301157890-4810ed352733?q=80&w=1000&auto=format&fit=crop",
    translations: {
      ko: {
        title: "형형색색 조화로운 웰빙 건강식, 오색 비빔밥",
        subtitle: "고소한 참기름과 약고추장으로 비벼 먹는 한국 대표 헬시 푸드",
        introduction: "비빔밥은 갓 지은 밥 위에 알록달록한 나물과 고기, 계란 프라이를 얹고 고추장과 고소한 참기름으로 슥슥 비벼 먹는 영양 만점 웰빙 식사입니다.",
        steps: [
          "당근과 애호박은 채 썰어 소금을 살짝 치고 기름에 빠르게 볶아냅니다.",
          "시금치와 콩나물은 끓는 물에 데친 뒤 물기를 꼭 짜고 소금, 다진 마늘, 참기름으로 조물조물 무칩니다.",
          "따뜻한 밥 1공기를 대접에 담고 준비한 나물들을 가장자리에 색깔별로 둘러 담습니다.",
          "가운데에 노른자가 살아있는 계란 프라이를 올립니다.",
          "비빔밥용 볶음고추장 1큰술과 참기름 1큰술, 통깨를 두르고 숟가락으로 골고루 비벼서 먹습니다."
        ]
      },
      de: {
        title: "Klassisches Koreanisches Bibimbap (Bunte Reisschale)",
        subtitle: "Ausgewogen, bunt und gesund mit frischem Gemüse & Spiegelei",
        introduction: "Bibimbap ('gemischter Reis') ist eine farbenfrohe Reisschale belegt mit verschiedenen Gemüsesorten, Ei und einer aromatischen Gochujang-Sesam-Sauce.",
        steps: [
          "Karotten und Zucchini in feine Streifen schneiden und kurz in der Pfanne anbraten.",
          "Spinat und Sojasprossen kurz blanchieren, ausdrücken und mit etwas Salz, Knoblauch und Sesamöl würzen.",
          "Eine Schale warmen Rundkornreis vorbereiten und das bunte Gemüse kreisförmig darauf anordnen.",
          "In die Mitte ein sonniges Spiegelei setzen.",
          "Mit 1 EL Gochujang (Bibimbap-Sauce), 1 EL Sesamöl und geröstetem Sesam anrichten und vor dem Essen kräftig durchmischen."
        ]
      },
      en: {
        title: "Classic Korean Rainbow Bibimbap Bowl",
        subtitle: "Healthy, Colorful, and Balanced Mixed Rice Bowl",
        introduction: "Bibimbap is Korea's world-famous mixed rice dish, packed with sautéed vegetables, an egg, and seasoned gochujang chili sauce.",
        steps: [
          "Julienne carrots and zucchini; sauté lightly in oil with a pinch of salt.",
          "Blanch spinach and bean sprouts; drain well and season with sesame oil and salt.",
          "Place warm steamed rice in a bowl and arrange colorful vegetables neatly around the perimeter.",
          "Top with a sunny-side-up fried egg.",
          "Add 1 tbsp Gochujang sauce, 1 tbsp toasted sesame oil, and sesame seeds. Mix thoroughly before eating."
        ]
      }
    },
    defaultIngredients: [
      { id: "ing_rice", nameKo: "한국 쌀", nameDe: "Koreanischer Rundkornreis", nameEn: "Korean Short Grain Rice", amount: 300, unit: "g", type: "REQUIRED", searchKeywords: ["쌀", "rice", "shinode", "rhee chun"], suggestedPackageQty: 1 },
      { id: "ing_bibim_sauce", nameKo: "비빔밥용 볶음고추장", nameDe: "Bibimbap Chilisauce (Fertigsauce)", nameEn: "Korean Bibimbap Sauce", amount: 1, unit: "tube", type: "REQUIRED", searchKeywords: ["비빔고추장", "bibimbap sauce", "cj bibim"], suggestedPackageQty: 1 },
      { id: "ing_sesame_oil", nameKo: "참기름", nameDe: "Geröstetes Sesamöl", nameEn: "Roasted Sesame Oil", amount: 2, unit: "tbsp", type: "REQUIRED", searchKeywords: ["참기름", "sesame oil"], suggestedPackageQty: 1 },
      { id: "ing_seaweed_snack", nameKo: "조미김 (김가루)", nameDe: "Geröstete Seetang-Snacks", nameEn: "Seasoned Seaweed Snack", amount: 1, unit: "pack", type: "OPTIONAL", searchKeywords: ["김", "seaweed", "dongwon"], suggestedPackageQty: 1 }
    ]
  },
  {
    id: "kimchibokkeumbap",
    category: "RICE_NOODLES",
    occasion: "QUICK_MEAL",
    difficulty: "EASY",
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    baseServings: 1,
    spiceLevel: 2,
    dietaryFlags: ["VEGETARIAN"],
    imageUrl: "https://images.unsplash.com/photo-1627308595260-6fad84c1ec66?q=80&w=1000&auto=format&fit=crop",
    translations: {
      ko: {
        title: "10분 완성 감칠맛 폭발 김치볶음밥",
        subtitle: "고소한 파기름과 바삭한 반숙 계란후라이의 환상 조합",
        introduction: "김치볶음밥은 잘게 썬 신김치를 파기름에 볶다가 밥과 굴소스(또는 간장)를 넣고 고슬고슬하게 볶아내는 한국 자취생 필수 요리입니다.",
        steps: [
          "대파 1/2대를 쫑쫑 썰고 신김치 1컵(150g)은 가위로 잘게 자릅니다. 스팸이나 베이컨을 함께 썰어 넣어도 좋습니다.",
          "팬에 식용유 2큰술을 두르고 대파를 볶아 향긋한 파기름을 냅니다.",
          "김치와 고춧가루 1/2큰술, 진간장 1큰술을 팬 가장자리에 눌어붙듯 끓여 불향을 입히며 함께 볶습니다.",
          "밥 1공기를 넣고 주걱을 세워 밥알이 뭉치지 않게 고루 볶습니다.",
          "마지막에 참기름 1큰술과 김가루, 반숙 계란 프라이를 얹어 완성합니다."
        ]
      },
      de: {
        title: "10-Minuten Kimchi-Gebratener Reis (Kimchi Bokkeumbap)",
        subtitle: "Super schnell, aromatisch & knusprig mit Spiegelei",
        introduction: "Kimchi Bokkeumbap ist der beliebteste koreanische gebratene Reis: Feurig-säuerlicher Kimchi gebraten in Frühlingszwiebelöl, serviert mit flüssigem Spiegelei.",
        steps: [
          "Kimchi (150g) und Frühlingszwiebeln fein hacken (optional Spam oder Tofu hinzufügen).",
          "In einer Pfanne mit 2 EL Öl die Frühlingszwiebeln anbraten, bis sie duften.",
          "Kimchi, 1/2 EL Chiliflocken und 1 EL Sojasauce dazugeben und ca. 2-3 Minuten braten.",
          "Gekochten Reis hineingeben und kräftig unterrühren.",
          "Mit 1 EL Sesamöl verfeinern und mit Spiegelei und Seetangstreifen toppen."
        ]
      },
      en: {
        title: "10-Minute Savory Kimchi Fried Rice (Kimchi Bokkeumbap)",
        subtitle: "Quick, Flavorful, and Topped with a Runny Fried Egg",
        introduction: "Kimchi Bokkeumbap is the ultimate quick Korean comfort meal made by stir-frying chopped aged kimchi with scallion oil, rice, and toasted seaweed.",
        steps: [
          "Finely chop aged kimchi (150g) and slice scallions.",
          "Heat 2 tbsp oil in a skillet and fry scallions until fragrant.",
          "Add chopped kimchi, 1/2 tbsp chili powder, and 1 tbsp soy sauce; fry for 2-3 minutes.",
          "Add 1 bowl of cooked rice and break up chunks until fully incorporated.",
          "Drizzle with 1 tbsp sesame oil, top with a sunny-side-up egg and seaweed flakes."
        ]
      }
    },
    defaultIngredients: [
      { id: "ing_kimchi", nameKo: "종가집 김치", nameDe: "Koreanischer Kimchi", nameEn: "Korean Kimchi", amount: 150, unit: "g", type: "REQUIRED", searchKeywords: ["김치", "kimchi", "jongga"], suggestedPackageQty: 1 },
      { id: "ing_sesame_oil", nameKo: "참기름", nameDe: "Geröstetes Sesamöl", nameEn: "Roasted Sesame Oil", amount: 1, unit: "tbsp", type: "REQUIRED", searchKeywords: ["참기름", "sesame oil"], suggestedPackageQty: 1 },
      { id: "ing_seaweed_flakes", nameKo: "비비고 김자반", nameDe: "Kimjaban (Knusprige Seetangflocken)", nameEn: "Seasoned Seaweed Flakes", amount: 1, unit: "pack", type: "OPTIONAL", searchKeywords: ["김자반", "김가루", "bibigo seaweed"], suggestedPackageQty: 1 }
    ]
  },
  {
    id: "chapaguri",
    category: "RICE_NOODLES",
    occasion: "QUICK_MEAL",
    difficulty: "EASY",
    prepTimeMinutes: 2,
    cookTimeMinutes: 8,
    baseServings: 2,
    spiceLevel: 2,
    dietaryFlags: [],
    imageUrl: "https://images.unsplash.com/photo-1590301157890-4810ed352733?q=80&w=1000&auto=format&fit=crop",
    translations: {
      ko: {
        title: "영화 기생충의 그 메뉴! 채끝 짜파구리",
        subtitle: "짜파게티와 너구리의 환상 궁합에 소고기를 얹은 명품 라면",
        introduction: "짜파구리는 농심 짜파게티의 고소한 춘장 소스와 너구리의 얼큰하고 시원한 해물 다시마 스프가 만나 탄생한 한국 최고의 라면 조합 요리입니다.",
        steps: [
          "냄비에 물 1000ml를 붓고 끓으면 너구리의 건다시마와 두 라면의 후레이크를 넣습니다.",
          "물이 팔팔 끓으면 짜파게티 면과 너구리 면을 넣고 4분 30초간 삶습니다.",
          "면수 약 8~10큰술을 따로 남겨두고 나머지 물을 따라 버립니다.",
          "짜파게티 분말스프 1봉 전체와 너구리 분말스프 1/2~2/3봉을 넣고 남긴 면수와 함께 약불에서 1분간 빠르게 볶습니다.",
          "올리브조미유를 두르고 잘 구운 소고기 토핑(채끝 등)을 얹어 맛있게 즐깁니다."
        ]
      },
      de: {
        title: "Der Ramyeon-Kult aus dem Film Parasite: Chapaguri",
        subtitle: "Die perfekte Fusion aus Chapagetti & Neoguri mit saftigem Rindfleisch",
        introduction: "Chapaguri (auch 'Ram-Don' genannt) ist die virale Kombination aus koreanischen Chapagetti-Schwarzen Bohnennudeln und würzig-scharfem Neoguri-Meeresfrüchte-Ramyeon.",
        steps: [
          "In einem Topf 1000ml Wasser aufkochen und das getrocknete Gemüse und Seetang hineingeben.",
          "Beide Nudelsorten (Chapagetti + Neoguri) ca. 4.5 Minuten kochen lassen.",
          "Ca. 8 EL Nudelwasser beiseite stellen und das restliche Wasser abgießen.",
          "Die gesamte Chapagetti-Würzmischung und ca. 2/3 des Neoguri-Suppenpulvers mit dem Nudelwasser bei schwacher Hitze 1 Minute einrühren.",
          "Mit dem beiliegenden Olivenöl beträufeln und optional mit gebratenen Rindfleischstreifen servieren."
        ]
      },
      en: {
        title: "The Iconic Parasite Noodles: Chapaguri (Ram-Don)",
        subtitle: "Legendary Mashup of Chapagetti Black Bean & Spicy Neoguri Ramyeon",
        introduction: "Chapaguri is Korea's famous fusion comfort food made by blending savory Chapagetti chajang noodles with spicy Neoguri seafood ramen.",
        steps: [
          "Boil 1000ml of water and add the dried vegetable mix and kombu kelp.",
          "Add both noodle cakes (Chapagetti and Neoguri) and cook for 4.5 minutes.",
          "Reserve about 8 tbsp of the noodle cooking water and drain the rest.",
          "Add the full packet of Chapagetti seasoning and 2/3 packet of Neoguri seasoning, stir-frying on low heat for 1 minute with the reserved water.",
          "Drizzle with olive oil and top with pan-seared sirloin steak cubes."
        ]
      }
    },
    defaultIngredients: [
      { id: "ing_chapagetti", nameKo: "농심 짜파게티", nameDe: "Nongshim Chapagetti Nudeln", nameEn: "Nongshim Chapagetti Noodles", amount: 1, unit: "pack", type: "REQUIRED", searchKeywords: ["짜파게티", "chapagetti", "nongshim"], suggestedPackageQty: 1 },
      { id: "ing_neoguri", nameKo: "농심 너구리 (얼큰한맛)", nameDe: "Nongshim Neoguri Pikant", nameEn: "Nongshim Spicy Neoguri Noodles", amount: 1, unit: "pack", type: "REQUIRED", searchKeywords: ["너구리", "neoguri", "nongshim"], suggestedPackageQty: 1 }
    ]
  },

  {
    id: "gamjajorim",
    category: "SIDE_DISH",
    occasion: "STUDENT_BUDGET",
    difficulty: "EASY",
    prepTimeMinutes: 10,
    cookTimeMinutes: 15,
    baseServings: 4,
    spiceLevel: 0,
    dietaryFlags: ["VEGETARIAN", "VEGAN"],
    imageUrl: "https://images.unsplash.com/photo-1544025162-d76694265947?q=80&w=1000&auto=format&fit=crop",
    translations: {
      ko: {
        title: "단짠단짠 밥도둑 감자조림",
        subtitle: "포슬포슬한 감자에 간장 소스가 쏙 밴 대표 밑반찬",
        introduction: "감자조림은 깍둑썰기한 감자를 달콤 짭조름한 간장 양념에 윤기 나게 조려내는 한국 가정식의 대표 반찬입니다.",
        steps: [
          "감자 2개(300g)를 한입 크기(약 2cm)로 깍둑썰기하여 찬물에 5분간 담가 전분기를 뺍니다.",
          "달군 팬에 식용유 1큰술을 두르고 감자를 중약불에서 3분간 볶아 겉면을 코팅합니다.",
          "물 1컵(200ml), 진간장 3큰술, 설탕 1.5큰술, 맛술 1큰술을 넣고 센 불에서 끓입니다.",
          "끓어오르면 중불로 줄이고 뚜껑을 덮어 감자가 익을 때까지 약 8분간 조립니다.",
          "올리고당(또는 물엿) 1큰술과 참기름 1/2큰술, 통깨를 넣고 센 불에서 국물이 자작해질 때까지 1분간 빠르게 볶아 윤기를 냅니다."
        ]
      },
      de: {
        title: "Süß-Würzige Geschmorte Kartoffeln (Gamja Jorim)",
        subtitle: "Klassische koreanische Beilage (Banchan) - einfach & lecker",
        introduction: "Gamja Jorim sind mundgerechte Kartoffelwürfel, geschmort in einer glänzenden, süß-salzigen Sojasauce.",
        steps: [
          "2 Kartoffeln in ca. 2cm große Würfel schneiden und kurz in kaltem Wasser einweichen.",
          "In einer Pfanne mit 1 EL Öl die Kartoffeln 3 Minuten anbraten.",
          "200ml Wasser, 3 EL Sojasauce, 1.5 EL Zucker und 1 EL Mirin hinzugeben und aufkochen.",
          "Bei mittlerer Hitze zugedeckt ca. 8 Minuten schmoren, bis die Kartoffeln weich sind.",
          "1 EL Reissirup (oder Honig), 1/2 EL Sesamöl und Sesam dazugeben und kurz glänzend einkochen."
        ]
      },
      en: {
        title: "Sweet and Savory Braised Potatoes (Gamja Jorim)",
        subtitle: "Classic Korean Banchan Side Dish Loved by All Ages",
        introduction: "Gamja Jorim features bite-sized potato cubes braised in a glossy sweet and savory soy glaze.",
        steps: [
          "Cube 2 peeled potatoes into 2cm pieces; soak in cold water for 5 minutes.",
          "Heat 1 tbsp oil in a pan and sauté potatoes for 3 minutes.",
          "Add 200ml water, 3 tbsp soy sauce, 1.5 tbsp sugar, and 1 tbsp mirin; bring to a boil.",
          "Cover and simmer over medium heat for 8 minutes until tender.",
          "Add 1 tbsp rice syrup and 1/2 tbsp sesame oil, tossing over high heat for 1 minute for a glossy finish."
        ]
      }
    },
    defaultIngredients: [
      { id: "ing_soy_sauce", nameKo: "진간장", nameDe: "Koreanische Sojasauce", nameEn: "Korean Soy Sauce", amount: 3, unit: "tbsp", type: "REQUIRED", searchKeywords: ["간장", "soy sauce", "sempio"], suggestedPackageQty: 1 },
      { id: "ing_syrup", nameKo: "올리고당 / 물엿", nameDe: "Reissirup / Oligosaccharid-Sirup", nameEn: "Korean Cooking Syrup (Mulyeot)", amount: 1, unit: "tbsp", type: "REQUIRED", searchKeywords: ["올리고당", "물엿", "rice syrup", "cj syrup"], suggestedPackageQty: 1 },
      { id: "ing_sesame_oil", nameKo: "참기름", nameDe: "Geröstetes Sesamöl", nameEn: "Roasted Sesame Oil", amount: 1, unit: "tsp", type: "REQUIRED", searchKeywords: ["참기름", "sesame oil"], suggestedPackageQty: 1 }
    ]
  }
];

export function getPresetById(id) {
  return RECIPE_PRESETS.find((p) => p.id === id) || null;
}
