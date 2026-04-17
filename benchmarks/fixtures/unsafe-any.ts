type ApiResponse = unknown;

export function collectNames(response: ApiResponse) {
  const data = response as any;

  return data.users.map((item: any) => item.profile.name);
}
