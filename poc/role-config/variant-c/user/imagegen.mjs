// 사용자 러너: imagegen-cli. CCP 는 bin 과 argv() 만 사용한다.
export const bin = 'imagegen-cli';

// options = 역할의 model 과 러너 전용 키 (여기서는 size)
export function argv({ task, options, jobDir }) {
  return [
    'generate',
    '--model', options.model,
    ...(options.size ? ['--size', options.size] : []),
    '--out', jobDir,
    task,
  ];
}
