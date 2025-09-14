export type AnyLecture = Record<string, any>;
export type DayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const DAY_LABELS = ["월","화","수","목","금","토","일"] as const;

const norm = (v:any)=>String(v??"").trim();

export function extractProfessor(lec: AnyLecture): string {
  if (typeof lec?.instructor === "string") return lec.instructor;
  if (typeof lec?.professor === "string") return lec.professor;
  if (Array.isArray(lec?.instructors)) return lec.instructors.join(", ");
  return "";
}

export function allRooms(lec: AnyLecture): string[] {
  const times:any[] = Array.isArray(lec?.class_time_json)?lec.class_time_json:[];
  const s = new Set<string>();
  for (const t of times) {
    const r = norm(t?.place ?? t?.room ?? t?.location);
    if (r) s.add(r);
  }
  return [...s];
}

export type TimetableEvent = {
  day: DayIndex; start: number; end: number;
  title: string; professor: string; room: string;
  courseNumber?: string; lectureNumber?: string;
};

function toDayIndex(d:any):DayIndex{ const n=Number(d); return (n>=0&&n<=6?n:0) as DayIndex; }
function toMinutes(v:any){ if(typeof v==="number"&&isFinite(v))return v;
  const s=String(v??"").trim(); const m=s.match(/^(\d{1,2}):(\d{2})$/);
  if(m) return Number(m[1])*60+Number(m[2]); const n=Number(s); return isFinite(n)?n:0; }

export function buildEventsFromLectures(lectures:AnyLecture[], opts:{showBy:"professor"|"room";query:string}):TimetableEvent[]{
  const out:TimetableEvent[]=[];
  for(const lec of lectures){
    const title = lec?.course_title ?? lec?.title ?? "";
    const prof = extractProfessor(lec);
    const rooms = allRooms(lec);
    const times:any[] = Array.isArray(lec?.class_time_json)?lec.class_time_json:[];
    for(const t of times){
      const day = toDayIndex(t?.day ?? t?.dayOfWeek);
      const start = toMinutes(t?.startMinute ?? t?.start_minute ?? t?.start ?? t?.start_time);
      const end   = toMinutes(t?.endMinute   ?? t?.end_minute   ?? t?.end   ?? t?.end_time);
      if(!start && !end) continue;
      out.push({
        day, start, end, title, professor: prof,
        room: String(t?.place ?? t?.room ?? t?.location ?? rooms[0] ?? ""),
        courseNumber: lec?.course_number, lectureNumber: lec?.lecture_number
      });
    }
  }
  return out;
}

export type LaidOutEvent = TimetableEvent & { col:number; colCount:number };
export function layoutByDay(events:TimetableEvent[]):Record<DayIndex,LaidOutEvent[]>{
  const by:Record<DayIndex,TimetableEvent[]>={0:[],1:[],2:[],3:[],4:[],5:[],6:[]};
  for(const e of events) by[e.day].push(e);
  const laid:Record<DayIndex,LaidOutEvent[]>={0:[],1:[],2:[],3:[],4:[],5:[],6:[]};
  (Object.keys(by) as unknown as DayIndex[]).forEach(d=>{
    const list=by[d].sort((a,b)=>a.start-b.start||a.end-b.end);
    const lanes:number[]=[]; const placed:LaidOutEvent[]=[];
    for(const e of list){ let lane=0; while(lane<lanes.length&&lanes[lane]>e.start) lane++; lanes[lane]=e.end; placed.push({...e,col:lane,colCount:0}); }
    const cc=Math.max(1,lanes.length); laid[d]=placed.map(p=>({...p,colCount:cc}));
  });
  return laid;
}

export function timeBounds(events:TimetableEvent[]){ if(!events.length) return {startMin:8*60,endMin:22*60};
  const mins=events.flatMap(e=>[e.start,e.end]); return {startMin:Math.min(...mins,8*60), endMin:Math.max(...mins,22*60)}; }

export function lectureMatchesProfessorExact(lec:AnyLecture,q:string){ return norm(extractProfessor(lec))===norm(q); }
export function lectureMatchesRoomExact(lec:AnyLecture,q:string){ return allRooms(lec).some(r=>norm(r)===norm(q)); }
