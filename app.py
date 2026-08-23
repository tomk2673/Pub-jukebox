from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import sqlite3
from pathlib import Path

BASE = Path(__file__).parent
DB = BASE / 'jukebox.db'
app = FastAPI(title='PUB Jukebox')
app.mount('/static', StaticFiles(directory=BASE/'static'), name='static')
ADMIN_PIN='2673'

def db():
    c=sqlite3.connect(DB); c.row_factory=sqlite3.Row; return c

def init():
    c=db(); c.executescript('''
    CREATE TABLE IF NOT EXISTS queue(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT DEFAULT '',
      votes INTEGER DEFAULT 0,
      priority INTEGER DEFAULT 0,
      status TEXT DEFAULT 'queued');
    '''); c.commit(); c.close()

@app.on_event('startup')
def startup(): init()

class Song(BaseModel):
    video_id:str
    title:str
    artist:str=''
class Vote(BaseModel):
    delta:int=1

def admin(req:Request):
    if req.headers.get('x-admin-pin')!=ADMIN_PIN: raise HTTPException(403,'Admin only')

@app.get('/',response_class=HTMLResponse)
def kiosk(): return (BASE/'static/kiosk.html').read_text(encoding='utf-8')
@app.get('/guest',response_class=HTMLResponse)
def guest(): return (BASE/'static/guest.html').read_text(encoding='utf-8')
@app.get('/admin',response_class=HTMLResponse)
def admin_page(): return (BASE/'static/admin.html').read_text(encoding='utf-8')
@app.get('/tv',response_class=HTMLResponse)
def tv(): return (BASE/'static/tv.html').read_text(encoding='utf-8')

@app.get('/api/queue')
def queue():
    c=db(); rows=c.execute("""SELECT * FROM queue WHERE status IN ('playing','queued')
      ORDER BY CASE WHEN status='playing' THEN 0 ELSE 1 END, priority DESC, votes DESC, id ASC""").fetchall(); c.close()
    return [dict(x) for x in rows]

@app.post('/api/queue')
def add(song:Song):
    c=db(); cur=c.execute('INSERT INTO queue(video_id,title,artist) VALUES(?,?,?)',(song.video_id,song.title,song.artist)); c.commit();
    row=c.execute('SELECT * FROM queue WHERE id=?',(cur.lastrowid,)).fetchone(); c.close(); return dict(row)

@app.post('/api/queue/{sid}/vote')
def vote(sid:int,v:Vote):
    c=db(); c.execute("UPDATE queue SET votes=MAX(0,votes+?) WHERE id=? AND status='queued'",(1 if v.delta>=0 else -1,sid)); c.commit(); c.close(); return {'ok':True}

@app.post('/api/queue/{sid}/priority')
def priority(sid:int,req:Request):
    admin(req); c=db(); c.execute("UPDATE queue SET priority=priority+1 WHERE id=? AND status='queued'",(sid,)); c.commit(); c.close(); return {'ok':True}

@app.post('/api/queue/{sid}/play')
def play(sid:int,req:Request):
    admin(req); c=db(); c.execute("UPDATE queue SET status='queued' WHERE status='playing'"); c.execute("UPDATE queue SET status='playing' WHERE id=?",(sid,)); c.commit(); c.close(); return {'ok':True}

@app.post('/api/next')
def next_song(req:Request):
    admin(req); c=db(); c.execute("UPDATE queue SET status='done' WHERE status='playing'"); n=c.execute("SELECT id FROM queue WHERE status='queued' ORDER BY priority DESC,votes DESC,id ASC LIMIT 1").fetchone();
    if n: c.execute("UPDATE queue SET status='playing' WHERE id=?",(n['id'],))
    c.commit(); c.close(); return {'ok':True,'next_id': n['id'] if n else None}

@app.delete('/api/queue/{sid}')
def delete(sid:int,req:Request):
    admin(req); c=db(); c.execute('DELETE FROM queue WHERE id=?',(sid,)); c.commit(); c.close(); return {'ok':True}
