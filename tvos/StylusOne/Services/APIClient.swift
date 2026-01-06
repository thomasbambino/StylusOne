import Foundation

enum APIError: Error, LocalizedError {
    case invalidURL
    case invalidResponse
    case httpError(statusCode: Int, message: String?)
    case decodingError(Error)
    case networkError(Error)
    case unauthorized
    case forbidden

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .invalidResponse:
            return "Invalid response from server"
        case .httpError(let statusCode, let message):
            return message ?? "HTTP Error \(statusCode)"
        case .decodingError(let error):
            return "Failed to decode response: \(error.localizedDescription)"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .unauthorized:
            return "Not authenticated"
        case .forbidden:
            return "Access denied"
        }
    }
}

actor APIClient {
    static let shared = APIClient()

    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    private init() {
        let config = URLSessionConfiguration.default
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        config.httpCookieStorage = HTTPCookieStorage.shared

        self.session = URLSession(configuration: config)

        self.decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .iso8601

        self.encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
    }

    // MARK: - Generic Request Methods

    func get<T: Decodable>(_ endpoint: String) async throws -> T {
        let request = try buildRequest(endpoint: endpoint, method: "GET")
        return try await performRequest(request)
    }

    func post<T: Decodable, B: Encodable>(_ endpoint: String, body: B) async throws -> T {
        var request = try buildRequest(endpoint: endpoint, method: "POST")
        request.httpBody = try encoder.encode(body)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return try await performRequest(request)
    }

    func post(_ endpoint: String) async throws {
        var request = try buildRequest(endpoint: endpoint, method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let _: EmptyResponse = try await performRequest(request)
    }

    func post<B: Encodable>(_ endpoint: String, body: B) async throws {
        var request = try buildRequest(endpoint: endpoint, method: "POST")
        request.httpBody = try encoder.encode(body)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let _: EmptyResponse = try await performRequest(request)
    }

    func delete(_ endpoint: String) async throws {
        let request = try buildRequest(endpoint: endpoint, method: "DELETE")
        let _: EmptyResponse = try await performRequest(request)
    }

    // MARK: - Private Helpers

    private func buildRequest(endpoint: String, method: String) throws -> URLRequest {
        guard let url = URL(string: APIConfig.baseURL + endpoint) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("StylusOne/1.0 (tvOS)", forHTTPHeaderField: "User-Agent")

        // Add session cookie if available
        if let cookie = KeychainService.shared.getSessionCookie() {
            request.setValue("sessionId=\(cookie)", forHTTPHeaderField: "Cookie")
        }

        return request
    }

    private func performRequest<T: Decodable>(_ request: URLRequest) async throws -> T {
        do {
            let (data, response) = try await session.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }

            // Store any session cookies
            if let headerFields = httpResponse.allHeaderFields as? [String: String],
               let url = request.url {
                let cookies = HTTPCookie.cookies(withResponseHeaderFields: headerFields, for: url)
                for cookie in cookies where cookie.name == "sessionId" {
                    KeychainService.shared.saveSessionCookie(cookie.value)
                }
            }

            switch httpResponse.statusCode {
            case 200...299:
                // Handle empty responses
                if data.isEmpty || T.self == EmptyResponse.self {
                    if let empty = EmptyResponse() as? T {
                        return empty
                    }
                }

                do {
                    return try decoder.decode(T.self, from: data)
                } catch {
                    throw APIError.decodingError(error)
                }

            case 401:
                throw APIError.unauthorized

            case 403:
                throw APIError.forbidden

            default:
                let message = String(data: data, encoding: .utf8)
                throw APIError.httpError(statusCode: httpResponse.statusCode, message: message)
            }

        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.networkError(error)
        }
    }
}

// Helper for endpoints that return no body
struct EmptyResponse: Decodable {
    init() {}
}
