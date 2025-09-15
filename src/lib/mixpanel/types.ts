export interface Event {
  id: number;
  event: string;
  from_where: string;
  day: string;
  category: string[];
  url: string;
  priority: number;
  url_id?: string;
  created_at?: string;
  item_type?: "event" | "gifticon";
  table_name?: string; // 테이블 이름을 저장할 필드 추가
}
