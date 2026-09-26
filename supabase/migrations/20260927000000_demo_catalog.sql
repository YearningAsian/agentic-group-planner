-- Dummy city catalog for the trip-draft screens. Fares are round-trip display dollars from New York.
-- The same document ships in web/src/lib/demo/city-catalog.json.

create table public.demo_catalog (
  id text primary key,
  document jsonb not null,
  updated_at timestamptz not null default now(),
  constraint demo_catalog_singleton check (id = 'cities')
);

create trigger demo_catalog_set_updated_at before update on public.demo_catalog
  for each row execute function public.set_updated_at();

alter table public.demo_catalog enable row level security;

create policy "demo_catalog: anyone reads" on public.demo_catalog
  for select to anon, authenticated using (true);

insert into public.demo_catalog (id, document)
values ('cities', $catalog$
{
  "destinations": [
    { "id": "lisbon", "label": "Lisbon", "country": "Portugal", "code": "LIS", "lng": -9.1393, "lat": 38.7223, "blurb": "Hills, tiles, and late dinners", "photos": ["photo-1555881400-74d7acaacd8b", "photo-1533106497176-45ae19e68ba2", "photo-1585208798174-6cedd86e019a"] },
    { "id": "kyoto", "label": "Kyoto", "country": "Japan", "code": "KIX", "lng": 135.7681, "lat": 35.0116, "blurb": "Temples and quiet mornings", "photos": ["photo-1493976040374-85c8e12f0c0e", "photo-1524413840807-0c3cb6fa808d", "photo-1545569341-9eb8b30979d9"] },
    { "id": "mexico-city", "label": "Mexico City", "country": "Mexico", "code": "MEX", "lng": -99.1332, "lat": 19.4326, "blurb": "Markets, museums, and long tables", "photos": ["photo-1518659526054-190340b32735", "photo-1585464231875-d9ef1f5ad396", "photo-1512813195386-6cf811ad3542"] },
    { "id": "reykjavik", "label": "ReykjavÃ­k", "country": "Iceland", "code": "KEF", "lng": -21.9426, "lat": 64.1466, "blurb": "Pools, weather, and long light", "photos": ["photo-1476610182048-b716b8518aae", "photo-1504829857797-ddff29c27927", "photo-1529963183134-61a90db47eaf"] },
    { "id": "new-orleans", "label": "New Orleans", "country": "USA", "code": "MSY", "lng": -90.0715, "lat": 29.9511, "blurb": "Porches, music, and spice", "photos": ["photo-1569949381669-ecf31ae8e613", "photo-1571896349842-33c89424de2d", "photo-1568402102990-bc541580b59f"] },
    { "id": "barcelona", "label": "Barcelona", "country": "Spain", "code": "BCN", "lng": 2.1734, "lat": 41.3851, "blurb": "Sea, design, and late walks", "photos": ["photo-1583422409516-2895a77efded", "photo-1539037116277-4db20889f2d4", "photo-1523531294919-4bcd7c65e216"] },
    { "id": "london", "label": "London", "country": "United Kingdom", "code": "LHR", "lng": -0.1276, "lat": 51.5072, "blurb": "Parks, pubs, and long museums", "photos": ["photo-1513635269975-59663e0ac1ad", "photo-1486299267070-83823f5448dd", "photo-1520986606214-8b456906c813"] },
    { "id": "paris", "label": "Paris", "country": "France", "code": "CDG", "lng": 2.3522, "lat": 48.8566, "blurb": "Cafes, bridges, and late trains", "photos": ["photo-1502602898657-3e91760cbb34", "photo-1431274172761-fca41d930114", "photo-1499856871958-5b9627545d1a"] },
    { "id": "tokyo", "label": "Tokyo", "country": "Japan", "code": "HND", "lng": 139.6917, "lat": 35.6895, "blurb": "Neighborhoods, rail, and night food", "photos": ["photo-1540959733332-eab4deabeeaf", "photo-1536098561742-ca998e48cbcc", "photo-1554797589-7241bb691973"] },
    { "id": "los-angeles", "label": "Los Angeles", "country": "USA", "code": "LAX", "lng": -118.2437, "lat": 34.0522, "blurb": "Coast, canyons, and long drives", "photos": ["photo-1534190760961-74e8c1c5c3da", "photo-1515895309288-a3815ab7cf81", "photo-1444723121867-7a241cacace9"] },
    { "id": "chicago", "label": "Chicago", "country": "USA", "code": "ORD", "lng": -87.6298, "lat": 41.8781, "blurb": "Lake, architecture, and deep dishes", "photos": ["photo-1494522855154-9297ac14b55f", "photo-1477959858617-67f85cf4f1df", "photo-1569949381669-ecf31ae8e613"] },
    { "id": "miami", "label": "Miami", "country": "USA", "code": "MIA", "lng": -80.1918, "lat": 25.7617, "blurb": "Water, color, and late nights", "photos": ["photo-1533106497176-45ae19e68ba2", "photo-1514214246283-d427a95c5d2f", "photo-1535498730771-e735b998cd64"] },
    { "id": "atlanta", "label": "Atlanta", "country": "USA", "code": "ATL", "lng": -84.388, "lat": 33.749, "blurb": "Beltline, parks, and porch weather", "photos": ["photo-1575931953324-fcac7094999e", "photo-1568515387631-8b650bbcdb90", "photo-1558618666-fcd25c85cd64"] },
    { "id": "rome", "label": "Rome", "country": "Italy", "code": "FCO", "lng": 12.4964, "lat": 41.9028, "blurb": "Ruins, fountains, and long lunches", "photos": ["photo-1552832230-c0197dd311b5", "photo-1529260830199-42c24126f198", "photo-1515542622106-78bda8ba0e5b"] },
    { "id": "amsterdam", "label": "Amsterdam", "country": "Netherlands", "code": "AMS", "lng": 4.9041, "lat": 52.3676, "blurb": "Canals, bikes, and small museums", "photos": ["photo-1534351590666-13e3e96b5017", "photo-1459679749680-18eb1eb37418", "photo-1512470876302-972faa2aa9a4"] },
    { "id": "seoul", "label": "Seoul", "country": "South Korea", "code": "ICN", "lng": 126.978, "lat": 37.5665, "blurb": "Markets, palaces, and night streets", "photos": ["photo-1534274988757-a28bf1a57c17", "photo-1517154421773-0529f29ea451", "photo-1546874177-9e664107314e"] }
  ],
  "flights": {
    "lisbon": [
      { "airline": "Mariner", "depart": "6:20 PM", "arrive": "6:35 AM+1", "duration": "7h 15m", "stops": "Nonstop", "price": 548 },
      { "airline": "Cedar Air", "depart": "10:05 PM", "arrive": "2:40 PM+1", "duration": "11h 35m", "stops": "1 stop", "price": 389 },
      { "airline": "Lumen", "depart": "8:50 AM", "arrive": "9:05 PM", "duration": "7h 15m", "stops": "Nonstop", "price": 712 }
    ],
    "kyoto": [
      { "airline": "Mariner", "depart": "11:10 AM", "arrive": "4:45 PM+1", "duration": "16h 35m", "stops": "1 stop", "price": 980 },
      { "airline": "Cedar Air", "depart": "1:20 AM", "arrive": "7:55 AM+1", "duration": "18h 35m", "stops": "1 stop", "price": 734 },
      { "airline": "Lumen", "depart": "9:40 AM", "arrive": "6:50 PM+1", "duration": "18h 10m", "stops": "1 stop", "price": 1095 }
    ],
    "mexico-city": [
      { "airline": "Mariner", "depart": "7:15 AM", "arrive": "11:40 AM", "duration": "5h 25m", "stops": "Nonstop", "price": 286 },
      { "airline": "Cedar Air", "depart": "3:50 PM", "arrive": "9:35 PM", "duration": "6h 45m", "stops": "1 stop", "price": 214 },
      { "airline": "Lumen", "depart": "6:05 PM", "arrive": "10:20 PM", "duration": "5h 15m", "stops": "Nonstop", "price": 364 }
    ],
    "reykjavik": [
      { "airline": "Mariner", "depart": "8:30 PM", "arrive": "6:15 AM+1", "duration": "5h 45m", "stops": "Nonstop", "price": 412 },
      { "airline": "Cedar Air", "depart": "5:10 PM", "arrive": "6:40 AM+1", "duration": "9h 30m", "stops": "1 stop", "price": 318 },
      { "airline": "Lumen", "depart": "9:55 PM", "arrive": "7:30 AM+1", "duration": "5h 35m", "stops": "Nonstop", "price": 529 }
    ],
    "new-orleans": [
      { "airline": "Mariner", "depart": "9:05 AM", "arrive": "11:50 AM", "duration": "3h 45m", "stops": "Nonstop", "price": 178 },
      { "airline": "Cedar Air", "depart": "2:25 PM", "arrive": "6:40 PM", "duration": "5h 15m", "stops": "1 stop", "price": 142 },
      { "airline": "Lumen", "depart": "6:40 PM", "arrive": "9:20 PM", "duration": "3h 40m", "stops": "Nonstop", "price": 246 }
    ],
    "barcelona": [
      { "airline": "Mariner", "depart": "7:45 PM", "arrive": "9:10 AM+1", "duration": "7h 25m", "stops": "Nonstop", "price": 612 },
      { "airline": "Cedar Air", "depart": "11:30 PM", "arrive": "4:15 PM+1", "duration": "11h 45m", "stops": "1 stop", "price": 447 },
      { "airline": "Lumen", "depart": "10:20 AM", "arrive": "11:55 PM", "duration": "7h 35m", "stops": "Nonstop", "price": 804 }
    ],
    "london": [
      { "airline": "Mariner", "depart": "6:10 PM", "arrive": "6:00 AM+1", "duration": "6h 50m", "stops": "Nonstop", "price": 648 },
      { "airline": "Cedar Air", "depart": "8:40 PM", "arrive": "11:15 AM+1", "duration": "9h 35m", "stops": "1 stop", "price": 472 },
      { "airline": "Lumen", "depart": "9:05 AM", "arrive": "8:55 PM", "duration": "6h 50m", "stops": "Nonstop", "price": 814 }
    ],
    "paris": [
      { "airline": "Mariner", "depart": "7:15 PM", "arrive": "8:35 AM+1", "duration": "7h 20m", "stops": "Nonstop", "price": 612 },
      { "airline": "Cedar Air", "depart": "10:20 PM", "arrive": "1:05 PM+1", "duration": "10h 45m", "stops": "1 stop", "price": 458 },
      { "airline": "Lumen", "depart": "10:40 AM", "arrive": "11:55 PM", "duration": "7h 15m", "stops": "Nonstop", "price": 786 }
    ],
    "tokyo": [
      { "airline": "Mariner", "depart": "11:00 AM", "arrive": "2:05 PM+1", "duration": "14h 05m", "stops": "Nonstop", "price": 1184 },
      { "airline": "Cedar Air", "depart": "1:30 AM", "arrive": "9:40 AM+1", "duration": "17h 10m", "stops": "1 stop", "price": 896 },
      { "airline": "Lumen", "depart": "6:20 PM", "arrive": "9:30 PM+1", "duration": "14h 10m", "stops": "Nonstop", "price": 1490 }
    ],
    "los-angeles": [
      { "airline": "Mariner", "depart": "8:15 AM", "arrive": "11:20 AM", "duration": "6h 05m", "stops": "Nonstop", "price": 312 },
      { "airline": "Cedar Air", "depart": "1:40 PM", "arrive": "6:55 PM", "duration": "8h 15m", "stops": "1 stop", "price": 228 },
      { "airline": "Lumen", "depart": "6:50 PM", "arrive": "9:55 PM", "duration": "6h 05m", "stops": "Nonstop", "price": 418 }
    ],
    "chicago": [
      { "airline": "Mariner", "depart": "7:30 AM", "arrive": "9:10 AM", "duration": "2h 40m", "stops": "Nonstop", "price": 164 },
      { "airline": "Cedar Air", "depart": "12:15 PM", "arrive": "3:20 PM", "duration": "4h 05m", "stops": "1 stop", "price": 128 },
      { "airline": "Lumen", "depart": "5:45 PM", "arrive": "7:25 PM", "duration": "2h 40m", "stops": "Nonstop", "price": 214 }
    ],
    "miami": [
      { "airline": "Mariner", "depart": "8:05 AM", "arrive": "11:15 AM", "duration": "3h 10m", "stops": "Nonstop", "price": 196 },
      { "airline": "Cedar Air", "depart": "2:30 PM", "arrive": "7:05 PM", "duration": "4h 35m", "stops": "1 stop", "price": 148 },
      { "airline": "Lumen", "depart": "6:20 PM", "arrive": "9:30 PM", "duration": "3h 10m", "stops": "Nonstop", "price": 268 }
    ],
    "atlanta": [
      { "airline": "Mariner", "depart": "7:50 AM", "arrive": "10:15 AM", "duration": "2h 25m", "stops": "Nonstop", "price": 172 },
      { "airline": "Cedar Air", "depart": "1:10 PM", "arrive": "5:00 PM", "duration": "3h 50m", "stops": "1 stop", "price": 136 },
      { "airline": "Lumen", "depart": "7:40 PM", "arrive": "10:05 PM", "duration": "2h 25m", "stops": "Nonstop", "price": 228 }
    ],
    "rome": [
      { "airline": "Mariner", "depart": "5:50 PM", "arrive": "8:30 AM+1", "duration": "8h 40m", "stops": "Nonstop", "price": 688 },
      { "airline": "Cedar Air", "depart": "9:15 PM", "arrive": "2:40 PM+1", "duration": "11h 25m", "stops": "1 stop", "price": 524 },
      { "airline": "Lumen", "depart": "9:30 AM", "arrive": "12:10 AM+1", "duration": "8h 40m", "stops": "Nonstop", "price": 872 }
    ],
    "amsterdam": [
      { "airline": "Mariner", "depart": "6:40 PM", "arrive": "7:55 AM+1", "duration": "7h 15m", "stops": "Nonstop", "price": 574 },
      { "airline": "Cedar Air", "depart": "11:05 PM", "arrive": "3:20 PM+1", "duration": "10h 15m", "stops": "1 stop", "price": 436 },
      { "airline": "Lumen", "depart": "8:55 AM", "arrive": "10:10 PM", "duration": "7h 15m", "stops": "Nonstop", "price": 748 }
    ],
    "seoul": [
      { "airline": "Mariner", "depart": "12:40 PM", "arrive": "4:25 PM+1", "duration": "14h 45m", "stops": "Nonstop", "price": 1076 },
      { "airline": "Cedar Air", "depart": "10:15 PM", "arrive": "8:05 AM+2", "duration": "18h 50m", "stops": "1 stop", "price": 824 },
      { "airline": "Lumen", "depart": "1:10 AM", "arrive": "4:50 PM+1", "duration": "14h 40m", "stops": "Nonstop", "price": 1412 }
    ]
  },
  "stays": {
    "lisbon": [
      { "name": "Alfama townhouse", "neighborhood": "Alfama", "rating": 4.94, "reviews": 186, "price": 168 },
      { "name": "Tile-roof flat", "neighborhood": "Baixa", "rating": 4.81, "reviews": 92, "price": 124 },
      { "name": "River-view loft", "neighborhood": "Cais do SodrÃ©", "rating": 4.88, "reviews": 140, "price": 210 }
    ],
    "kyoto": [
      { "name": "Machiya with a garden", "neighborhood": "Gion", "rating": 4.97, "reviews": 74, "price": 242 },
      { "name": "Lane house", "neighborhood": "Higashiyama", "rating": 4.86, "reviews": 121, "price": 176 },
      { "name": "Inn near the river", "neighborhood": "Pontocho", "rating": 4.9, "reviews": 88, "price": 198 }
    ],
    "mexico-city": [
      { "name": "Courtyard apartment", "neighborhood": "Roma Norte", "rating": 4.91, "reviews": 203, "price": 132 },
      { "name": "Tree-lined flat", "neighborhood": "Condesa", "rating": 4.84, "reviews": 156, "price": 118 },
      { "name": "Rooftop studio", "neighborhood": "JuÃ¡rez", "rating": 4.79, "reviews": 97, "price": 96 }
    ],
    "reykjavik": [
      { "name": "Harbor cottage", "neighborhood": "GrandagarÃ°ur", "rating": 4.93, "reviews": 64, "price": 228 },
      { "name": "Quiet studio", "neighborhood": "MiÃ°bÃ¦r", "rating": 4.77, "reviews": 81, "price": 164 },
      { "name": "House with a hot tub", "neighborhood": "VesturbÃ¦r", "rating": 4.96, "reviews": 52, "price": 286 }
    ],
    "new-orleans": [
      { "name": "Shotgun cottage", "neighborhood": "Marigny", "rating": 4.89, "reviews": 143, "price": 154 },
      { "name": "Balcony suite", "neighborhood": "French Quarter", "rating": 4.83, "reviews": 210, "price": 189 },
      { "name": "Garden house", "neighborhood": "Garden District", "rating": 4.95, "reviews": 77, "price": 206 }
    ],
    "barcelona": [
      { "name": "Eixample apartment", "neighborhood": "Eixample", "rating": 4.9, "reviews": 168, "price": 176 },
      { "name": "Gothic-quarter flat", "neighborhood": "El Born", "rating": 4.85, "reviews": 134, "price": 158 },
      { "name": "Sea-facing rooms", "neighborhood": "Barceloneta", "rating": 4.8, "reviews": 99, "price": 194 }
    ],
    "london": [
      { "name": "Shoreditch loft", "neighborhood": "Shoreditch", "rating": 4.86, "reviews": 214, "price": 210 },
      { "name": "Covent Garden flat", "neighborhood": "Covent Garden", "rating": 4.91, "reviews": 176, "price": 186 },
      { "name": "South Bank rooms", "neighborhood": "South Bank", "rating": 4.78, "reviews": 143, "price": 248 }
    ],
    "paris": [
      { "name": "Marais apartment", "neighborhood": "Le Marais", "rating": 4.92, "reviews": 188, "price": 198 },
      { "name": "Canal flat", "neighborhood": "Canal Saint-Martin", "rating": 4.84, "reviews": 121, "price": 164 },
      { "name": "Left Bank rooms", "neighborhood": "Saint-Germain", "rating": 4.88, "reviews": 156, "price": 236 }
    ],
    "tokyo": [
      { "name": "Shinjuku hotel", "neighborhood": "Shinjuku", "rating": 4.8, "reviews": 240, "price": 176 },
      { "name": "Asakusa inn", "neighborhood": "Asakusa", "rating": 4.87, "reviews": 132, "price": 142 },
      { "name": "Shibuya rooms", "neighborhood": "Shibuya", "rating": 4.76, "reviews": 198, "price": 214 }
    ],
    "los-angeles": [
      { "name": "Venice bungalow", "neighborhood": "Venice", "rating": 4.85, "reviews": 167, "price": 189 },
      { "name": "Silver Lake flat", "neighborhood": "Silver Lake", "rating": 4.9, "reviews": 98, "price": 156 },
      { "name": "Santa Monica rooms", "neighborhood": "Santa Monica", "rating": 4.82, "reviews": 143, "price": 242 }
    ],
    "chicago": [
      { "name": "West Loop loft", "neighborhood": "West Loop", "rating": 4.88, "reviews": 154, "price": 168 },
      { "name": "Lincoln Park flat", "neighborhood": "Lincoln Park", "rating": 4.83, "reviews": 119, "price": 142 },
      { "name": "River North rooms", "neighborhood": "River North", "rating": 4.79, "reviews": 201, "price": 198 }
    ],
    "miami": [
      { "name": "South Beach studio", "neighborhood": "South Beach", "rating": 4.81, "reviews": 226, "price": 176 },
      { "name": "Wynwood loft", "neighborhood": "Wynwood", "rating": 4.86, "reviews": 134, "price": 148 },
      { "name": "Coconut Grove rooms", "neighborhood": "Coconut Grove", "rating": 4.9, "reviews": 88, "price": 210 }
    ],
    "atlanta": [
      { "name": "Midtown hotel", "neighborhood": "Midtown", "rating": 4.74, "reviews": 163, "price": 154 },
      { "name": "Old Fourth Ward loft", "neighborhood": "Old Fourth Ward", "rating": 4.86, "reviews": 97, "price": 128 },
      { "name": "Buckhead rooms", "neighborhood": "Buckhead", "rating": 4.8, "reviews": 141, "price": 196 }
    ],
    "rome": [
      { "name": "Trastevere apartment", "neighborhood": "Trastevere", "rating": 4.93, "reviews": 178, "price": 172 },
      { "name": "Monti flat", "neighborhood": "Monti", "rating": 4.87, "reviews": 112, "price": 148 },
      { "name": "Centro rooms", "neighborhood": "Centro Storico", "rating": 4.79, "reviews": 204, "price": 214 }
    ],
    "amsterdam": [
      { "name": "Jordaan apartment", "neighborhood": "Jordaan", "rating": 4.91, "reviews": 149, "price": 188 },
      { "name": "De Pijp flat", "neighborhood": "De Pijp", "rating": 4.84, "reviews": 126, "price": 156 },
      { "name": "Canal rooms", "neighborhood": "Grachtengordel", "rating": 4.89, "reviews": 171, "price": 232 }
    ],
    "seoul": [
      { "name": "Hongdae loft", "neighborhood": "Hongdae", "rating": 4.82, "reviews": 193, "price": 124 },
      { "name": "Jongno hanok stay", "neighborhood": "Jongno", "rating": 4.94, "reviews": 86, "price": 148 },
      { "name": "Gangnam rooms", "neighborhood": "Gangnam", "rating": 4.77, "reviews": 158, "price": 186 }
    ]
  }
}

$catalog$::jsonb);
