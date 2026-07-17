"use client";
import { useState, useEffect, useRef } from "react";

// Date+time picker: separate DD/MM/YYYY fields + 24h time, avoids browser locale issues entirely
export default function DateTimePicker24h({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  // value is ISO-like "YYYY-MM-DDTHH:mm"
  const [datePart, timePart] = value ? value.split("T") : ["", ""];
  const [y, m, d] = datePart ? datePart.split("-") : ["", "", ""];
  const [hh, mm] = timePart ? timePart.split(":") : ["00", "00"];

  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(y ? parseInt(y) : new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(m ? parseInt(m)-1 : new Date().getMonth()); // 0-indexed
  const [textVal, setTextVal] = useState(d && m && y ? `${d}/${m}/${y} ${hh.padStart(2,"0")}:${mm.padStart(2,"0")}` : "");
  const [inputFocused, setInputFocused] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (inputFocused) return; // don't override while user is typing
    if (d && m && y) setTextVal(`${d}/${m}/${y} ${hh.padStart(2,"0")}:${mm.padStart(2,"0")}`);
    else setTextVal("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const monthNames = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
  const dayNames = ["อา","จ","อ","พ","พฤ","ศ","ส"];

  const handleTextChange = (v: string) => {
    setTextVal(v);
    const match = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
    if (match) {
      const [, dd, mo, yr, hr, mi] = match;
      const iso = `${yr}-${mo.padStart(2,"0")}-${dd.padStart(2,"0")}T${hr.padStart(2,"0")}:${mi}`;
      onChange(iso);
      setViewYear(parseInt(yr));
      setViewMonth(parseInt(mo)-1);
    }
  };

  const selectDate = (day: number) => {
    const dd = String(day).padStart(2,"0");
    const mm2 = String(viewMonth+1).padStart(2,"0");
    const iso = `${viewYear}-${mm2}-${dd}T${hh.padStart(2,"0")}:${mm.padStart(2,"0")}`;
    onChange(iso);
  };

  const setTime = (nhh: string, nmm: string) => {
    if (!d) return; // need a date selected first
    const iso = `${y}-${m}-${d}T${(nhh||"00").padStart(2,"0")}:${(nmm||"00").padStart(2,"0")}`;
    onChange(iso);
  };

  const daysInMonth = new Date(viewYear, viewMonth+1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sun
  const selectedDay = (y===String(viewYear) && m===String(viewMonth+1).padStart(2,"0")) ? parseInt(d) : null;
  const today = new Date();
  const isToday = (day:number) => viewYear===today.getFullYear() && viewMonth===today.getMonth() && day===today.getDate();

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <div style={{ display:"flex", gap:6 }}>
        <input
          type="text"
          value={textVal}
          onChange={e=>handleTextChange(e.target.value)}
          onFocus={()=>setInputFocused(true)}
          onBlur={()=>{
            setInputFocused(false);
            if (d && m && y) setTextVal(`${d}/${m}/${y} ${hh.padStart(2,"0")}:${mm.padStart(2,"0")}`);
          }}
          placeholder="DD/MM/YYYY HH:mm"
          style={{
            flex:1, background:"var(--bg)", border:"1px solid var(--line)", borderRadius:6,
            padding:"10px 12px", color:"var(--ink)", fontSize:14, boxSizing:"border-box",
            outline:"none", minWidth:0
          }}
        />
        <button onClick={()=>setOpen(!open)} type="button" style={{
          background:"var(--card)", border:"1px solid var(--line)", borderRadius:6,
          padding:"10px 12px", color:"var(--brass)", fontSize:14, cursor:"pointer", flexShrink:0
        }}>
          📅{open?"▲":"▼"}
        </button>
      </div>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 100,
          background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 14,
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)"
        }}>
          {/* Month/Year nav */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <button type="button" onClick={()=>{ if(viewMonth===0){setViewMonth(11);setViewYear(viewYear-1);} else setViewMonth(viewMonth-1); }}
              style={{background:"var(--line)",border:"none",borderRadius:5,color:"var(--ink)",cursor:"pointer",padding:"4px 10px",fontSize:14}}>‹</button>
            <div style={{fontSize:13,fontWeight:600,color:"var(--ink)"}}>{monthNames[viewMonth]} {viewYear}</div>
            <button type="button" onClick={()=>{ if(viewMonth===11){setViewMonth(0);setViewYear(viewYear+1);} else setViewMonth(viewMonth+1); }}
              style={{background:"var(--line)",border:"none",borderRadius:5,color:"var(--ink)",cursor:"pointer",padding:"4px 10px",fontSize:14}}>›</button>
          </div>

          {/* Day headers */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:4}}>
            {dayNames.map(dn=>(<div key={dn} style={{textAlign:"center",fontSize:11,color:"var(--faint)",padding:"2px 0"}}>{dn}</div>))}
          </div>

          {/* Day grid */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:12}}>
            {Array.from({length:firstDayOfWeek}).map((_,i)=>(<div key={`pad-${i}`}/>))}
            {Array.from({length:daysInMonth}).map((_,i)=>{
              const day = i+1;
              const isSelected = selectedDay===day;
              return (
                <button key={day} type="button" onClick={()=>selectDate(day)} style={{
                  background: isSelected?"var(--brass)":"transparent",
                  border: isToday(day)&&!isSelected?"1px solid var(--brass)":"none",
                  borderRadius: 6, color: isSelected?"var(--on-brass)":"var(--ink)", cursor:"pointer",
                  padding:"6px 0", fontSize:13, fontWeight: isSelected?700:400
                }}>{day}</button>
              );
            })}
          </div>

          {/* Time picker */}
          <div style={{display:"flex",alignItems:"center",gap:8,paddingTop:10,borderTop:"1px solid var(--line)"}}>
            <span style={{fontSize:12,color:"var(--mut)"}}>เวลา</span>
            <select value={hh} onChange={e=>setTime(e.target.value,mm)} disabled={!d}
              style={{background:"var(--bg)",border:"1px solid var(--line)",borderRadius:5,color:"var(--ink)",fontSize:13,padding:"6px 8px"}}>
              {Array.from({length:24}).map((_,i)=>(<option key={i} value={String(i).padStart(2,"0")}>{String(i).padStart(2,"0")}</option>))}
            </select>
            <span style={{color:"var(--faint)"}}>:</span>
            <select value={mm} onChange={e=>setTime(hh,e.target.value)} disabled={!d}
              style={{background:"var(--bg)",border:"1px solid var(--line)",borderRadius:5,color:"var(--ink)",fontSize:13,padding:"6px 8px"}}>
              {Array.from({length:60}).map((_,i)=>(<option key={i} value={String(i).padStart(2,"0")}>{String(i).padStart(2,"0")}</option>))}
            </select>
            <span style={{fontSize:11,color:"var(--line)"}}>(24h)</span>
            <button type="button" onClick={()=>setOpen(false)} style={{marginLeft:"auto",background:"var(--brass)",border:"none",borderRadius:5,color:"var(--on-brass)",cursor:"pointer",padding:"6px 14px",fontSize:12,fontWeight:600}}>เสร็จ</button>
          </div>
        </div>
      )}
    </div>
  );
}
