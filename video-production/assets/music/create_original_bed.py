"""Original deterministic 120 BPM instrumental loop. Python standard library only."""
from pathlib import Path
import math,struct,wave
rate=24000;duration=24;out=Path(__file__).with_name('studio-original.wav')
chords=[(130.813,164.814,195.998),(110,130.813,164.814),(87.307,110,130.813),(97.999,123.471,146.832)]
with wave.open(str(out),'wb') as f:
 f.setnchannels(2);f.setsampwidth(2);f.setframerate(rate)
 frames=bytearray()
 for n in range(rate*duration):
  t=n/rate;beat=t%0.5;bar=int(t//2)%4;chord=chords[bar]
  pad=sum(math.sin(2*math.pi*hz*t)*.035 for hz in chord)*(0.65+0.35*math.sin(math.pi*(t%2)/2))
  kick=math.sin(2*math.pi*(52*beat+40*(1-math.exp(-25*beat))/25))*math.exp(-22*beat)*.20
  sub=math.sin(2*math.pi*chord[0]/2*t)*math.exp(-5*beat)*.12
  tick=(math.sin(2*math.pi*7301*t)+math.sin(2*math.pi*9119*t))*math.exp(-110*(t%.25))*.012
  note=chord[int(t*4)%3]*4;pluck=math.sin(2*math.pi*note*t)*math.exp(-17*(t%.25))*.05
  envelope=min(1,t/.04,(duration-t)/.05);value=max(-1,min(1,(pad+kick+sub+tick+pluck)*envelope))
  v=round(value*32767);frames.extend(struct.pack('<hh',v,v))
 f.writeframes(frames)
print(out.name)
