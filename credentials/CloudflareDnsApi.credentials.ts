import {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class CloudflareDnsApi implements ICredentialType {
	name = 'cloudflareDnsApi';
	displayName = 'Cloudflare DNS API';
	documentationUrl = 'https://certbot-dns-cloudflare.readthedocs.io/';
	properties: INodeProperties[] = [
		{
			displayName: 'Authentication Method',
			name: 'authMethod',
			type: 'options',
			options: [
				{
					name: 'API Token (Recommended)',
					value: 'apiToken',
				},
				{
					name: 'Global API Key',
					value: 'globalApiKey',
				},
			],
			default: 'apiToken',
		},
		{
			displayName: 'API Token',
			name: 'apiToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			displayOptions: {
				show: {
					authMethod: ['apiToken'],
				},
			},
			description: 'Cloudflare API Token with DNS:Edit permissions for the target zone',
		},
		{
			displayName: 'Email',
			name: 'email',
			type: 'string',
			placeholder: 'name@email.com',
			default: '',
			displayOptions: {
				show: {
					authMethod: ['globalApiKey'],
				},
			},
			description: 'Cloudflare account email address',
		},
		{
			displayName: 'Global API Key',
			name: 'globalApiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			displayOptions: {
				show: {
					authMethod: ['globalApiKey'],
				},
			},
			description: 'Cloudflare Global API Key (found in My Profile → API Tokens)',
		},
	];
}
