// 봇을 가까이 찍는 장면(2026-11-17, 2단계 ①에서 더함). npm run shots와 scripts/_botprobe.mjs가 같이 쓴다.
// 봇이 화면에 크게 들어오는 장면이 08-bot-in-room 하나뿐이라, 봇의 몸을 바꾸는 묶음은 전체 화면 A/B가 갈리지 않는다.
// 정지 화면 이름은 NN-close-bot-…이다. 숫자로 시작해 A/B 도구가 짝을 짓고, -close-가 있어 npm run sheet의 레퍼런스 비교(critic)에서는 빠진다
// vp: 플레이어 x,z,yaw,pitch. bots: i,x,z,yaw,mode(idle, aim, march, run, dead)를 ;로 잇는다(src/main.js reset).
// frames: 찍기 전에 흘려보낼 1/60초 프레임 수
export const BOT_SHOTS = [
  { name: '22-close-bot-room', vp: '8,-5.6,3.1416,-0.04', bots: '1,8.7,-3.5,-2.5,idle' },
  { name: '23-close-bot-aiming', vp: '8,-5.6,3.1416,0', bots: '1,8.8,-3.0,3.0,aim' },
  { name: '24-close-bot-yard', vp: '6,20,0.22,0', bots: '0,4.76,17.2,1.79,idle' },
  { name: '25-close-bot-corridor', vp: '-11,-5.8,-1.5708,0', bots: '3,-8.0,-6.05,1.5708,aim' },
  { name: '26-close-bot-doorway', vp: '-7.5,-3.2,2.94,0', bots: '2,-7.65,-1.3,3.1416,idle' },
  { name: '27-close-bot-hall', vp: '2,-8,1.0,0.05', bots: '2,-0.62,-9.1,-2.6,idle' },
  { name: '28-close-bot-down', vp: '8,-5.6,3.1416,-0.45', bots: '1,8.5,-4.0,-2.8,dead', frames: 240 },
];
// 연속 프레임(1초 8장). 봇이 움직이는 동안의 몸과 장비
export const BOT_STRIPS = [
  { name: 'bot-walk-yard', vp: '6,20,0.22,0', bots: '0,2.31,17.23,-1.35,march', frames: 60 },
  { name: 'bot-run-yard', vp: '6,20,0.22,0', bots: '0,-0.13,17.78,-1.35,run', frames: 40 },
  { name: 'bot-walk-room', vp: '8,-5.6,3.1416,0', bots: '1,7.4,-3.2,-1.5708,march', frames: 30 },
];
