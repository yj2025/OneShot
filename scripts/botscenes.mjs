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
  // 2단계 ②(2026-11-18): 플레이어가 봇 가슴을 겨눠 2프레임과 14프레임에 쏜다(fire). 첫 발에 맞아 움찔하고 둘째 발에 쓰러진다.
  //  시점은 총구 방향이 봇 가슴을 지나도록 scripts/_aimprobe.mjs로 맞췄다. 봇을 맞히는 테스트 API 없이 플레이어 입력만 쓰므로 기준선 빌드에서도 같은 절차로 찍힌다
  { name: 'bot-shot-room', vp: '8,-5.6,-2.9353,0.0241', bots: '1,8.4,-3.1,0.3,idle', fire: [2, 14] },
  { name: 'bot-shot-yard', vp: '6,20,0.4782,0.0068', bots: '0,4.2,16.4,-0.5,idle', fire: [2, 14] },
  // 2단계 ②: 봇이 가까이(2.3 m)서 걷고 뛰는 묶음. 위의 걷기 묶음은 봇이 작아 시트 크기에서 다리 움직임이 보이지 않았다(A/B 70)
  { name: 'bot-walk-near', vp: '0,16,0,-0.12', bots: '0,-2.7,13.9,-1.5708,march', frames: 20 },
  { name: 'bot-run-near', vp: '0,16,0,-0.12', bots: '0,-3.9,13.6,-1.5708,run', frames: 6 },
  // 2단계 ②(12:15): 총과 팔을 그리지 않는(novm) 묶음. 쏘는 장면에서 총과 팔이 봇을 가리고 봇이 작아 A/B 70~72가 세 번 판정 불가였다.
  //  봇이 화면 가운데에 크게 나오게 해 움찔, 쓰러짐, 걸음만 비교한다. 기준선 빌드도 novm=1을 지원한다
  { name: 'bot-fall-novm', vp: '0,16,0.4007,0.0295', bots: '0,-0.9,13.7,-2.77,aim', fire: [2, 14], novm: true },
  { name: 'bot-shot-room-novm', vp: '8,-5.6,-2.9353,0.0241', bots: '1,8.4,-3.1,0.3,idle', fire: [2, 14], novm: true },
  { name: 'bot-shot-yard-novm', vp: '6,20,0.4782,0.0068', bots: '0,4.2,16.4,-0.5,idle', fire: [2, 14], novm: true },
  { name: 'bot-walk-near-novm', vp: '0,16,0,-0.12', bots: '0,-2.7,13.9,-1.5708,march', frames: 20, novm: true },
  { name: 'bot-run-near-novm', vp: '0,16,0,-0.12', bots: '0,-3.9,13.6,-1.5708,run', frames: 6, novm: true },
];
