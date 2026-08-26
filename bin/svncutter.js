#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

function parseArgs(argv) {
  const args = { wc: null, target: null, input: null, deployConfig: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--wc') args.wc = argv[++i];
    else if (a === '--target') args.target = argv[++i];
    else if (a === '--input') args.input = argv[++i];
    else if (a === '--deploy-config') args.deployConfig = argv[++i];
    else if (a === '-h' || a === '--help') args.help = true;
  }
  return args;
}

function printUsage() {
  console.log(`
svncutter - TortoiseSVN 커밋 경로 목록으로 배포용 파일을 묶어주는 도구

사용법:
  svncutter --wc <작업복사본 모듈 루트> --target <배포 대상 베이스 폴더> [옵션]

옵션:
  --wc <path>             필수. src/main/java, src/main/resources, src/main/webapp 를
                          포함하는 로컬 모듈 루트 경로 (Maven 표준 구조)
  --target <path>         필수. 배포 결과물을 만들 베이스 폴더. 그 아래 오늘 날짜
                          (YYYYMMDD) 폴더가 자동 생성되고, 이미 있으면 _1, _2 로 증가
  --input <path>          선택. TortoiseSVN에서 복사한 경로 목록을 담은 텍스트 파일.
                          생략하면 터미널에 붙여넣기를 기다립니다.
  --deploy-config <path>  선택. 원격 서버 SFTP 배포 설정 파일(JSON) 경로.
                          지정하면 로컬 배포 폴더 생성 후 내용을 보여주고
                          확인을 받아 원격 서버로 업로드합니다.

예시:
  svncutter --wc D:\\svn\\somtg --target D:\\deploy\\somtg
  svncutter --wc D:\\svn\\somtg --target D:\\deploy\\somtg --deploy-config D:\\svn\\somtg.deploy.json
`);
}

let sharedRl = null;
function getSharedRl() {
  if (!sharedRl) {
    sharedRl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  }
  return sharedRl;
}
function closeSharedRl() {
  if (sharedRl) {
    sharedRl.close();
    sharedRl = null;
  }
}

function readStdin() {
  console.log('TortoiseSVN에서 복사한 경로 목록을 붙여넣으세요.');
  console.log('붙여넣기가 끝나면 Enter 를 한 번 더 눌러(빈 줄) 입력을 마쳐주세요. (취소: Ctrl+C)\n');
  const rl = getSharedRl();
  return new Promise((resolve) => {
    const lines = [];
    const onLine = (line) => {
      if (line.trim() === '') {
        rl.removeListener('line', onLine);
        resolve(lines.join('\n'));
        return;
      }
      lines.push(line);
    };
    rl.on('line', onLine);
  });
}

function getInputText(args) {
  if (args.input) {
    return fs.readFileSync(path.resolve(args.input), 'utf8');
  }
  return readStdin();
}

const ANCHORS = [
  { key: 'java', marker: '/src/main/java/' },
  { key: 'resources', marker: '/src/main/resources/' },
  { key: 'webapp', marker: '/src/main/webapp/' },
];

function classify(svnPath) {
  for (const a of ANCHORS) {
    const idx = svnPath.indexOf(a.marker);
    if (idx !== -1) {
      const relPath = svnPath.slice(idx + a.marker.length);
      return { type: a.key, relPath };
    }
  }
  return null;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function resolveDatedTargetDir(baseTarget) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const dateStr = `${y}${m}${d}`;

  let candidate = path.join(baseTarget, dateStr);
  let suffix = 0;
  while (fs.existsSync(candidate)) {
    suffix += 1;
    candidate = path.join(baseTarget, `${dateStr}_${suffix}`);
  }
  return candidate;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findClassFiles(dir, baseName) {
  if (!fs.existsSync(dir)) return [];
  const re = new RegExp(`^${escapeRegExp(baseName)}(\\$.+)?\\.class$`);
  return fs.readdirSync(dir).filter((f) => re.test(f));
}

function loadDeployConfig(configPath) {
  const raw = fs.readFileSync(path.resolve(configPath), 'utf8');
  const cfg = JSON.parse(raw);
  if (!cfg.host || !cfg.username || !cfg.remotePath) {
    throw new Error('배포 설정 파일에는 host, username, remotePath 가 반드시 있어야 합니다.');
  }
  cfg.port = cfg.port || 22;
  cfg.remotePath = cfg.remotePath.replace(/\/+$/, '');
  return cfg;
}

function promptConfirm(question) {
  const rl = getSharedRl();
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

function promptPassword(question) {
  if (!process.stdin.isTTY) {
    return Promise.reject(new Error('비밀번호 입력을 받으려면 실제 터미널에서 실행해야 합니다.'));
  }
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (char) => {
      switch (char) {
        case '\n':
        case '\r':
        case '':
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(value);
          break;
        case '':
          process.stdout.write('\n');
          process.exit(1);
          break;
        case '':
        case '\b':
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
          break;
        default:
          value += char;
          process.stdout.write('*');
          break;
      }
    };
    stdin.on('data', onData);
  });
}

async function deployToRemote(cfg, destDir, uploadItems, deleteItems) {
  const SftpClient = require('ssh2-sftp-client');
  const sftp = new SftpClient();

  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  const backupRoot = `${cfg.remotePath}/_backup/${ts}`;

  const uploadActions = uploadItems.map((relPath) => ({
    relPath,
    localPath: path.join(destDir, ...relPath.split('/')),
    remotePath: `${cfg.remotePath}/${relPath}`,
  }));
  const deleteActions = deleteItems.map((relPath) => ({
    relPath,
    remotePath: `${cfg.remotePath}/${relPath}`,
  }));

  if (uploadActions.length === 0 && deleteActions.length === 0) {
    console.log('\n원격으로 반영할 변경 사항이 없어 원격 배포를 건너뜁니다.');
    return { cancelled: true, reason: '변경 사항 없음', uploaded: [], deleted: [], backedUp: [], errors: [], backupRoot };
  }

  console.log('\n=== 원격 배포 계획 ===');
  console.log(`대상 서버: ${cfg.username}@${cfg.host}:${cfg.port}`);
  console.log(`원격 경로: ${cfg.remotePath}`);
  console.log(`백업 위치: ${backupRoot} (기존 파일이 있을 때만)`);
  console.log(`\n업로드 ${uploadActions.length}건:`);
  uploadActions.forEach((a) => console.log(`  ↑ ${a.relPath}`));
  console.log(`삭제 ${deleteActions.length}건 (삭제 전 자동 백업):`);
  deleteActions.forEach((a) => console.log(`  x ${a.relPath}`));

  const confirmed = await promptConfirm('\n위 내용대로 원격 서버에 반영할까요? (y/N): ');
  closeSharedRl();
  if (!confirmed) {
    console.log('취소되었습니다. 원격 서버에는 아무 변경도 하지 않았습니다.');
    return { cancelled: true, reason: '사용자가 확인하지 않음', uploaded: [], deleted: [], backedUp: [], errors: [], backupRoot };
  }

  const connectOpts = { host: cfg.host, port: cfg.port, username: cfg.username };
  if (cfg.privateKeyPath) {
    connectOpts.privateKey = fs.readFileSync(path.resolve(cfg.privateKeyPath));
  } else {
    connectOpts.password = await promptPassword(`${cfg.username}@${cfg.host} 비밀번호: `);
  }

  console.log('\n원격 서버에 연결 중...');
  await sftp.connect(connectOpts);

  const uploaded = [];
  const deleted = [];
  const backedUp = [];
  const errors = [];

  try {
    for (const a of uploadActions) {
      try {
        await sftp.mkdir(path.posix.dirname(a.remotePath), true);
        const existsType = await sftp.exists(a.remotePath);
        if (existsType) {
          const backupDest = `${backupRoot}/${a.relPath}`;
          const content = await sftp.get(a.remotePath);
          await sftp.mkdir(path.posix.dirname(backupDest), true);
          await sftp.put(content, backupDest);
          backedUp.push(a.relPath);
        }
        await sftp.put(a.localPath, a.remotePath);
        uploaded.push(a.relPath);
      } catch (err) {
        errors.push(`${a.relPath} (업로드) : ${err.message}`);
      }
    }

    for (const a of deleteActions) {
      try {
        const existsType = await sftp.exists(a.remotePath);
        if (!existsType) continue;
        const backupDest = `${backupRoot}/${a.relPath}`;
        const content = await sftp.get(a.remotePath);
        await sftp.mkdir(path.posix.dirname(backupDest), true);
        await sftp.put(content, backupDest);
        backedUp.push(a.relPath);
        await sftp.delete(a.remotePath);
        deleted.push(a.relPath);
      } catch (err) {
        errors.push(`${a.relPath} (삭제) : ${err.message}`);
      }
    }
  } finally {
    await sftp.end();
  }

  return { cancelled: false, uploaded, deleted, backedUp, errors, backupRoot };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.wc || !args.target) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  const wc = path.resolve(args.wc);
  const targetBase = path.resolve(args.target);

  if (!fs.existsSync(wc)) {
    console.error(`[오류] 작업 복사본 경로가 존재하지 않습니다: ${wc}`);
    process.exit(1);
  }

  const rawText = await getInputText(args);
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    console.error('[오류] 처리할 경로가 없습니다. 붙여넣은 내용이나 --input 파일을 확인하세요.');
    process.exit(1);
  }

  const destDir = resolveDatedTargetDir(targetBase);
  ensureDir(destDir);

  const copiedJavaClasses = [];
  const copiedResources = [];
  const copiedWebapp = [];
  const deletedList = [];
  const warnings = [];
  const skipped = [];

  for (const line of lines) {
    const classified = classify(line);
    if (!classified) {
      skipped.push(line);
      continue;
    }
    const { type, relPath } = classified;
    const relParts = relPath.split('/');

    if (type === 'webapp') {
      const sourceFile = path.join(wc, 'src', 'main', 'webapp', ...relParts);
      const destFile = path.join(destDir, ...relParts);
      if (!fs.existsSync(sourceFile)) {
        deletedList.push({ relPath });
        continue;
      }
      ensureDir(path.dirname(destFile));
      fs.copyFileSync(sourceFile, destFile);
      copiedWebapp.push(relPath);
      continue;
    }

    if (type === 'resources') {
      const sourceFile = path.join(wc, 'src', 'main', 'resources', ...relParts);
      const destFile = path.join(destDir, 'WEB-INF', 'classes', ...relParts);
      if (!fs.existsSync(sourceFile)) {
        deletedList.push({ relPath: `WEB-INF/classes/${relPath}` });
        continue;
      }
      ensureDir(path.dirname(destFile));
      fs.copyFileSync(sourceFile, destFile);
      copiedResources.push(relPath);
      continue;
    }

    if (type === 'java') {
      const sourceFile = path.join(wc, 'src', 'main', 'java', ...relParts);
      const relDirParts = relParts.slice(0, -1);
      const baseName = path.basename(relParts[relParts.length - 1], '.java');
      const classSourceDir = path.join(wc, 'target', 'classes', ...relDirParts);
      const classDestDir = path.join(destDir, 'WEB-INF', 'classes', ...relDirParts);

      if (!fs.existsSync(sourceFile)) {
        const classRelPath = relDirParts.concat(`${baseName}.class`).join('/');
        deletedList.push({
          relPath: `WEB-INF/classes/${classRelPath}`,
          note: 'inner class 포함 삭제 필요할 수 있음',
        });
        continue;
      }

      const classFiles = findClassFiles(classSourceDir, baseName);
      if (classFiles.length === 0) {
        warnings.push(`${relPath} : 컴파일된 .class 파일을 찾지 못했습니다 (${classSourceDir}). 먼저 빌드했는지 확인하세요.`);
        continue;
      }

      ensureDir(classDestDir);
      for (const cf of classFiles) {
        fs.copyFileSync(path.join(classSourceDir, cf), path.join(classDestDir, cf));
        copiedJavaClasses.push(relDirParts.concat(cf).join('/'));
      }
      continue;
    }
  }

  if (deletedList.length > 0) {
    const header = '# 삭제 대상 목록 - 아래 경로는 서버 배포 시 수동으로 삭제해야 합니다\n';
    const deletedLines = deletedList.map((d) => (d.note ? `${d.relPath} (${d.note})` : d.relPath));
    fs.writeFileSync(path.join(destDir, 'deleted-list.txt'), header + deletedLines.join('\n') + '\n', 'utf8');
  }

  const status = warnings.length > 0 || skipped.length > 0 ? 'WARN' : 'OK';
  const report = [];
  report.push(`svncutter 처리 결과 - ${new Date().toLocaleString('ko-KR')}`);
  report.push(`상태: ${status}`);
  report.push(`작업 복사본: ${wc}`);
  report.push(`배포 폴더: ${destDir}`);
  report.push('');
  report.push(`Java class 복사: ${copiedJavaClasses.length}개`);
  copiedJavaClasses.forEach((f) => report.push(`  + ${f}`));
  report.push(`리소스 복사: ${copiedResources.length}개`);
  copiedResources.forEach((f) => report.push(`  + ${f}`));
  report.push(`웹 리소스(jsp/js 등) 복사: ${copiedWebapp.length}개`);
  copiedWebapp.forEach((f) => report.push(`  + ${f}`));
  report.push(`삭제 대상: ${deletedList.length}개 (deleted-list.txt 참고)`);

  if (warnings.length > 0) {
    report.push('');
    report.push(`[경고] ${warnings.length}건`);
    warnings.forEach((w) => report.push(`  ! ${w}`));
  }
  if (skipped.length > 0) {
    report.push('');
    report.push(`[건너뜀] 인식할 수 없는 경로 ${skipped.length}건`);
    skipped.forEach((s) => report.push(`  ? ${s}`));
  }

  let reportText = report.join('\n') + '\n';
  fs.writeFileSync(path.join(destDir, 'result.txt'), reportText, 'utf8');
  console.log('\n' + reportText);
  console.log(`처리 결과 파일: ${path.join(destDir, 'result.txt')}`);

  if (warnings.length > 0) {
    process.exitCode = 2;
  }

  if (args.deployConfig) {
    const cfg = loadDeployConfig(args.deployConfig);
    const uploadItems = [
      ...copiedJavaClasses.map((f) => `WEB-INF/classes/${f}`),
      ...copiedResources.map((f) => `WEB-INF/classes/${f}`),
      ...copiedWebapp,
    ];
    const deleteItems = deletedList.map((d) => d.relPath);

    const deployResult = await deployToRemote(cfg, destDir, uploadItems, deleteItems);

    const deployReport = [];
    deployReport.push('');
    deployReport.push('=== 원격 배포 결과 ===');
    if (deployResult.cancelled) {
      deployReport.push(`상태: 건너뜀 (${deployResult.reason})`);
    } else {
      deployReport.push(`상태: ${deployResult.errors.length > 0 ? 'WARN' : 'OK'}`);
      deployReport.push(`대상 서버: ${cfg.username}@${cfg.host}:${cfg.port}`);
      deployReport.push(`원격 경로: ${cfg.remotePath}`);
      deployReport.push(`백업 위치: ${deployResult.backupRoot}`);
      deployReport.push(`업로드 성공: ${deployResult.uploaded.length}개`);
      deployReport.push(`삭제 성공: ${deployResult.deleted.length}개`);
      deployReport.push(`백업된 기존 파일: ${deployResult.backedUp.length}개`);
      if (deployResult.errors.length > 0) {
        deployReport.push(`오류 ${deployResult.errors.length}건:`);
        deployResult.errors.forEach((e) => deployReport.push(`  ! ${e}`));
        process.exitCode = 2;
      }
    }

    const deployReportText = deployReport.join('\n') + '\n';
    reportText += deployReportText;
    fs.writeFileSync(path.join(destDir, 'result.txt'), reportText, 'utf8');
    console.log(deployReportText);
  }

  closeSharedRl();
}

main()
  .catch((err) => {
    console.error(`[오류] ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    closeSharedRl();
  });
