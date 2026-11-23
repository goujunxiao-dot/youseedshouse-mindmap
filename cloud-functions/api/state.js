import { getStore } from '@edgeone/pages-blob';

// The editable board is selected by an unguessable 48-hex-character share token.
// No collaboration token is embedded in this public repository.
const STORE_NAME = 'youseedshouse-post-boards';
const META_ID = '00000000-0000-4000-8000-000000000001';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const KEY = /^[a-f0-9]{48}$/;
const COLORS = ['white', 'yellow', 'blue', 'green', 'pink', 'purple'];
const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
};
const json = (status, payload) => new Response(JSON.stringify(payload), {status, headers:HEADERS});
function clamp(value, min, max) {
  if(typeof value !== 'number' || !Number.isFinite(value)) throw new Error('非法位置或尺寸');
  return Math.max(min, Math.min(max, Math.round(value)));
}
function validate(body) {
  if(!body || typeof body !== 'object') throw new Error('请求格式有误');
  if(body.op === 'delete') {
    if(!UUID.test(String(body.id || '')) || body.id === META_ID) throw new Error('非法删除操作');
    return { id:body.id, kind:'deleted', data:{} };
  }
  if(body.op !== 'upsert') throw new Error('不支持的操作');
  const r = body.record;
  if(!r || !UUID.test(String(r.id || '')) || !r.data || typeof r.data !== 'object') throw new Error('记录格式有误');
  if(r.kind === 'meta') {
    if(r.id !== META_ID || typeof r.data.title !== 'string') throw new Error('非法标题');
    return { id:r.id, kind:'meta', data:{title:r.data.title.trim().slice(0,100) || '我的思维导图'} };
  }
  if(r.kind === 'node') {
    const d = r.data;
    if(typeof d.text !== 'string' || d.text.length > 2000 || !COLORS.includes(d.color)) throw new Error('非法模块文字或颜色');
    return {id:r.id, kind:'node', data: {
      text:d.text, color:d.color,
      x:clamp(d.x,-100000,100000), y:clamp(d.y,-100000,100000),
      w:clamp(d.w,130,620), h:clamp(d.h,66,420)
    }};
  }
  if(r.kind === 'edge') {
    const d = r.data;
    if(!UUID.test(String(d.source || '')) || !UUID.test(String(d.target || '')) || d.source === d.target) throw new Error('非法连线');
    return {id:r.id,kind:'edge',data:{source:d.source,target:d.target}};
  }
  throw new Error('不支持的模块类型');
}
async function getBoard(store, prefix) {
  const {blobs} = await store.list({prefix,consistency:'strong'});
  if(blobs.length > 4000) throw new Error('看板内容过多');
  const rows = [];
  for(let i=0;i<blobs.length;i+=20) {
    const group = blobs.slice(i,i+20);
    const values = await Promise.all(group.map(x=>store.get(x.key,{type:'json',consistency:'strong'})));
    for(const value of values) if(value && value.kind !== 'deleted') rows.push(value);
  }
  const nodeIds = new Set(rows.filter(r=>r.kind==='node').map(r=>r.id));
  return rows.filter(r=>r.kind!=='edge' || (nodeIds.has(r.data?.source) && nodeIds.has(r.data?.target)))
    .sort((a,b)=>a.id.localeCompare(b.id));
}
export async function onRequest({request}) {
  const url = new URL(request.url);
  const board = url.searchParams.get('key') || '';
  if(!KEY.test(board)) return json(403,{error:'协作链接无效'});
  const prefix = 'boards/' + board + '/records/';
  try {
    const store = getStore({name:STORE_NAME,consistency:'strong'});
    if(request.method === 'GET') return json(200,{rows:await getBoard(store,prefix)});
    if(request.method === 'POST') {
      const raw = await request.text();
      if(raw.length > 16000) return json(413,{error:'数据过长'});
      let body;
      try { body = JSON.parse(raw); } catch { return json(400,{error:'JSON 格式错误'}); }
      let record;
      try { record = validate(body); } catch(error) { return json(400,{error:String(error.message)}); }
      await store.setJSON(prefix + record.id + '.json',record);
      return json(200,{ok:true});
    }
    return json(405,{error:'请求方法不支持'});
  } catch(error) {
    console.error('mindmap blob error',error);
    return json(500,{error:'云端存储不可用'});
  }
}
